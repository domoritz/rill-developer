/**
 * dataset.ts
 * contains the actions that can be taken to construct a dataset.
 */

 import type { DataModelerState, Model, Item } from "../../lib/types"
 import { sanitizeQuery as _sanitizeQuery } from "../../lib/util/sanitize-query.js";
 import { guidGenerator } from "../../lib/util/guid.js";

interface NewQueryArguments { 
    query?: string;
    name?: string;
    at?: number;
    makeActive?: boolean;
}

let queryNumber = 1;

export function newQuery(params:NewQueryArguments = {}): Model {
    const query = params.query || '';
    const sanitizedQuery = _sanitizeQuery(query);
    const name = `${params.name || `query_${queryNumber}`}.sql`;
    queryNumber += 1;
    return {
		query,
        sanitizedQuery,
		name,
		id: guidGenerator(),
        preview: undefined,
        sizeInBytes: undefined
	};
}

export function emptyQuery(): Model {
	return newQuery({});
}

 // TODO: we use this in other modules. Probably should have single source
 export function getByID(items:(Item[]), id:string) : Item| null {
     return items.find(q => q.id === id);
 }
 
/**
 * NOTE: there's some amount of duplication within many of the summarizing functions.
 */
 export function createModelActions(api) {
 
     return {
        addQuery(params:NewQueryArguments) {
            const query = params.query || undefined;
            const name = params.name || undefined;
            const makeActive = params.makeActive || false;
            const at = params.at;
            return (draft:DataModelerState) => {
                if (at !== undefined) {
                    draft.models = [...draft.models.slice(0, at), newQuery({ query, name }), ...draft.models.slice(at)];
                } else {
                    const draftQuery = newQuery({ query, name })
                    draft.models.push(draftQuery);
                    if (makeActive) {
                        draft.activeAsset = {
                            id: draftQuery.id,
                            assetType: 'model'
                        }
                    }
                }

            };
        },
        updateQuery({id, query}) {
            return (draft:DataModelerState) => {
                const queryItem = getByID(draft.models, id) as Model;
                queryItem.query = query;
            };
        },

        setActiveAsset({ id, assetType }) {
            return (draft:DataModelerState) => {
                draft.activeAsset = { id, assetType };
            }
        },

        unsetActiveAsset() {
            return (draft:DataModelerState) => {
                draft.activeAsset = undefined;
            }
        },

        changeQueryName({id, name}) {
            return (draft:DataModelerState) => {
                draft.models.find((q) => q.id === id).name = name;
            }
        },

        releaseActiveQueryFocus({ id }) {
            return (draft:DataModelerState) => {
                if (draft.activeAsset.id === id) {
                    draft.activeAsset = undefined;
                }
            }
        },

        deleteQuery({id}) {
            return (draft:DataModelerState) => {
                draft.models = draft.models.filter(q => q.id !== id);
            }
        },

        moveQueryDown({id}) { 
            return (draft:DataModelerState) => {
                const idx = draft.models.findIndex((q) => q.id === id);
                if (idx < draft.models.length - 1) {
                    const thisQuery = { ...draft.models[idx] };
                    const nextQuery = { ...draft.models[idx + 1] };
                    draft.models[idx] = nextQuery;
                    draft.models[idx + 1] = thisQuery;
                }
            };
        },

        moveQueryUp({id}) {
            return (draft:DataModelerState) => {
                const idx = draft.models.findIndex((q) => q.id === id);
                if (idx > 0) {
                    const thisQuery = { ...draft.models[idx] };
                    const nextQuery = { ...draft.models[idx - 1] };
                    draft.models[idx] = nextQuery;
                    draft.models[idx - 1] = thisQuery;
                }
            }
        },
     }
 }