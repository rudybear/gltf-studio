// Runs the shared StorageProvider contract (packages/contract-tests/src/storage-provider.ts,
// SP-001..020) against IndexedDBStorage, backed by `fake-indexeddb` (an
// in-memory IDBFactory polyfill) so the suite runs under plain Node with no
// browser. Each `makeProvider()` call gets its own randomly-named database
// so tests never see another test's data (fake-indexeddb persists databases
// for the lifetime of the process, keyed by name).
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { describeStorageProviderContract } from "@gltf-studio/contract-tests";
import { IndexedDBStorage } from "./indexeddb-storage.js";

function freshDbName(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describeStorageProviderContract(
  () => new IndexedDBStorage({ indexedDB: fakeIndexedDB, dbName: freshDbName() }),
  () => new IndexedDBStorage({ indexedDB: fakeIndexedDB, dbName: freshDbName(), quotaLimitBytes: 0 })
);
