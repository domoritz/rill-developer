import {DatabaseActions} from "./DatabaseActions";
import type {CategoricalSummary, NumericSummary, TimeRangeSummary} from "$lib/types";
import type {DatabaseMetadata} from "$common/database-service/DatabaseMetadata";
import {sanitizeColumn} from "$common/utils/queryUtils";
import {TIMESTAMPS} from "$lib/duckdb-data-types";

const TOP_K_COUNT = 50;

export enum TimeGrain {
  milliseconds = "milliseconds",
  seconds = "seconds",
  minutes = "minutes",
  hours = "hours",
  days = "days",
  weeks = "weeks",
  months = "months",
  years = "years"
}

/**
 * All database column actions return javascript objects that get folded 
 * into a `summary` field in the derived table. Thus any action in this file must
 * return an object.
 */
export class DatabaseColumnActions extends DatabaseActions {
    public async getTopKAndCardinality(metadata: DatabaseMetadata, tableName: string, columnName: string,
                                       func = "count(*)"): Promise<CategoricalSummary> {
        return {
            topK: await this.getTopKOfColumn(metadata, tableName, columnName, func),
            cardinality: await this.getCardinalityOfColumn(metadata, tableName, columnName),
        };
    }

    public async getNullCount(metadata: DatabaseMetadata,
                              tableName: string, columnName: string): Promise<number> {
        const sanitizedColumName = sanitizeColumn(columnName);
        const [nullity] = await this.databaseClient.execute(
            `SELECT COUNT(*) as count FROM '${tableName}' WHERE ${sanitizedColumName} IS NULL;`);
        return nullity.count;
    }

    public async getDescriptiveStatistics(metadata: DatabaseMetadata,
                                          tableName: string, columnName: string): Promise<NumericSummary> {
        const sanitizedColumnName = sanitizeColumn(columnName);
        const [results] = await this.databaseClient.execute(`
            SELECT
                min(${sanitizedColumnName}) as min,
                reservoir_quantile(${sanitizedColumnName}, 0.25) as q25,
                reservoir_quantile(${sanitizedColumnName}, 0.5)  as q50,
                reservoir_quantile(${sanitizedColumnName}, 0.75) as q75,
                max(${sanitizedColumnName}) as max,
                avg(${sanitizedColumnName})::FLOAT as mean,
                stddev_pop(${sanitizedColumnName}) as sd
            FROM '${tableName}';
       `);
        return { statistics: results };
    }

    /**
     * Estimates the smallest time grain present in the column.
     * The "smallest time grain" is the smallest value that we believe the user
     * can reliably roll up. In other words, if the data is reported daily, this
     * action will return "day", since that's the smallest rollup grain we can
     * rely on.
     * 
     * This function can only focus on some common time grains. It will operate on
     * - ms
     * - second
     * - minute
     * - hour
     * - day
     * - week
     * - month
     * - year
     * 
     * It will not estimate any more nuanced or difficult-to-measure time grains, such as
     * quarters, once-a-month, etc.
     * 
     * It accomplishes its goal by sampling 500k values of a column and then estimating the cardinality
     * of each. If there are < 500k samples, the action will use all of the column's data.
     * We're not sure all the ways this heuristic will fail, but it seems pretty resilient to the tests
     * we've thrown at it.
     */
    public async estimateSmallestTimeGrain(metadata: DatabaseMetadata,
                                                tableName: string, columnName: string, sampleSize = 500000): Promise<{ estimatedSmallestTimeGrain: TimeGrain }> {
      const [total] = await this.databaseClient.execute(`
        SELECT count(*) as c from "${tableName}"
      `)
      const totalRows = total.c;
      // only sample when you have a lot of data.
      const useSample = sampleSize > totalRows ? '' : `USING SAMPLE ${(100 * sampleSize / totalRows)}%`

      const [ timeGrainResult ] = await this.databaseClient.execute(`
      WITH cleaned_column AS (
          SELECT "${columnName}" as cd
          from ${tableName}
          ${useSample}
      ),
      time_grains as (
      SELECT 
          approx_count_distinct(extract('years' from cd)) as year,
          approx_count_distinct(extract('months' from cd)) as month,
          approx_count_distinct(extract('dayofyear' from cd)) as dayofyear,
          approx_count_distinct(extract('dayofmonth' from cd)) as dayofmonth,
          min(cd = last_day(cd)) = TRUE as lastdayofmonth,
          approx_count_distinct(extract('weekofyear' from cd)) as weekofyear,
          approx_count_distinct(extract('dayofweek' from cd)) as dayofweek,
          approx_count_distinct(extract('hour' from cd)) as hour,
          approx_count_distinct(extract('minute' from cd)) as minute,
          approx_count_distinct(extract('second' from cd)) as second,
          approx_count_distinct(extract('millisecond' from cd) - extract('seconds' from cd) * 1000) as ms
      FROM cleaned_column
      )
      SELECT 
        COALESCE(
            case WHEN ms > 1 THEN 'milliseconds' else NULL END,
            CASE WHEN second > 1 THEN 'seconds' else NULL END,
            CASE WHEN minute > 1 THEN 'minutes' else null END,
            CASE WHEN hour > 1 THEN 'hours' else null END,
            -- cases above, if equal to 1, then we have some candidates for
            -- bigger time grains. We need to reverse from here
            -- years, months, weeks, days.
            CASE WHEN dayofyear = 1 and year > 1 THEN 'years' else null END,
            CASE WHEN (dayofmonth = 1 OR lastdayofmonth) and month > 1 THEN 'months' else null END,
            CASE WHEN dayofweek = 1 and weekofyear > 1 THEN 'weeks' else null END,
            CASE WHEN hour = 1 THEN 'days' else null END
        ) as estimatedSmallestTimeGrain
      FROM time_grains
      `);
      return timeGrainResult;
    }

    public async getNumericHistogram(metadata: DatabaseMetadata,
                                              tableName: string, columnName: string, columnType: string): Promise<NumericSummary> {
        const sanitizedColumnName = sanitizeColumn(columnName);
        // use approx_count_distinct to get the immediate cardinality of this column.
        const [buckets] = await this.databaseClient.execute(`SELECT approx_count_distinct(${sanitizedColumnName}) as count from ${tableName}`);
        const bucketSize = Math.min(40, buckets.count);
        const result = await this.databaseClient.execute(`
          WITH data_table AS (
            SELECT ${TIMESTAMPS.has(columnType) ? `epoch(${sanitizedColumnName})` : `${sanitizedColumnName}::DOUBLE`} as ${sanitizedColumnName} 
            FROM ${tableName}
            WHERE ${sanitizedColumnName} IS NOT NULL
          ), S AS (
            SELECT 
              min(${sanitizedColumnName}) as minVal,
              max(${sanitizedColumnName}) as maxVal,
              (max(${sanitizedColumnName}) - min(${sanitizedColumnName})) as range
              FROM data_table
          ), values AS (
            SELECT ${sanitizedColumnName} as value from data_table
            WHERE ${sanitizedColumnName} IS NOT NULL
          ), buckets AS (
            SELECT
              range as bucket,
              (range) * (select range FROM S) / ${bucketSize} + (select minVal from S) as low,
              (range + 1) * (select range FROM S) / ${bucketSize} + (select minVal from S) as high
            FROM range(0, ${bucketSize}, 1)
          ),
          histogram_stage AS (
          SELECT
              bucket,
              low,
              high,
              count(values.value) as count
            FROM buckets
            LEFT JOIN values ON (values.value >= low and values.value < high)
            GROUP BY bucket, low, high
            ORDER BY BUCKET
          ),
          -- calculate the right edge, sine in histogram_stage we don't look at the values that
          -- might be the largest.
          right_edge AS (
            SELECT count(*) as c from values WHERE value = (select maxVal from S)
          )
          SELECT 
            bucket,
            low,
            high,
            -- fill in the case where we've filtered out the highest value and need to recompute it, otherwise use count.
            CASE WHEN high = (SELECT max(high) from histogram_stage) THEN count + (select c from right_edge) ELSE count END AS count
            FROM histogram_stage
	      `);
        return { histogram: result };
    }

    public async getTimeRange(metadata: DatabaseMetadata,
                              tableName: string, columnName: string): Promise<TimeRangeSummary> {
        const sanitizedColumnName = sanitizeColumn(columnName);
        const [ranges] = await this.databaseClient.execute(`
	        SELECT
		    min(${sanitizedColumnName}) as min, max(${sanitizedColumnName}) as max, 
		    max(${sanitizedColumnName}) - min(${sanitizedColumnName}) as interval
		    FROM '${tableName}';
	    `);
        return ranges;
    }

    private async getTopKOfColumn(metadata: DatabaseMetadata,
                          tableName: string, columnName: string, func = "count(*)"): Promise<any> {
        const sanitizedColumnName = sanitizeColumn(columnName);
        return this.databaseClient.execute(`
            SELECT ${sanitizedColumnName} as value, ${func} AS count from '${tableName}'
            GROUP BY ${sanitizedColumnName}
            ORDER BY count desc
            LIMIT ${TOP_K_COUNT};
        `);
    }

    private async getCardinalityOfColumn(metadata: DatabaseMetadata,
                                 tableName: string, columnName: string): Promise<number> {
        const sanitizedColumnName = sanitizeColumn(columnName);
        const [results] = await this.databaseClient.execute(
            `SELECT approx_count_distinct(${sanitizedColumnName}) as count from '${tableName}';`);
        return results.count;
    }
}
