<script>
export let data;
$: header = Object.keys(data[0]);
</script>

<div class='table-container bg-white'>
    <table>
        <tr>
            {#each header as key}
                <th>{key}</th>
            {/each}
        </tr>
        {#each data as record}
            <tr>
                {#each header as key}
                    <td>{`${record[key]}`.slice(0,50)}</td>
                {/each}
            </tr>
        {/each}
    </table>
</div>

<style>
table {
    border-spacing: 20px;
}
td {
    min-width: 200px;
}
</style>