import type { AppStore } from "$lib/app-store";
import { dataModelerStateService } from "$lib/app-store";
import type {
    PersistentModelEntity, PersistentModelState
} from "$common/data-modeler-state-service/entity-state-service/PersistentModelEntityService";
import type {
    DerivedModelEntity, DerivedModelState
} from "$common/data-modeler-state-service/entity-state-service/DerivedModelEntityService";
import { EntityType, StateType } from "$common/data-modeler-state-service/entity-state-service/EntityStateService";

export type PersistentModelStore = AppStore<PersistentModelEntity, PersistentModelState>;
export function createPersistentModelStore(): PersistentModelStore {
    return dataModelerStateService
        .getEntityStateService(EntityType.Model, StateType.Persistent).store;
}

export type DerivedModelStore = AppStore<DerivedModelEntity, DerivedModelState>;
export function createDerivedModelStore(): DerivedModelStore {
    return dataModelerStateService
        .getEntityStateService(EntityType.Model, StateType.Derived).store;
}
