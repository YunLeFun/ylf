import type { CloudBase } from '@cloudbase/node-sdk'
import { CloudBaseSessionStore } from '../src'

type OfficialCloudBaseDatabase = ReturnType<CloudBase['database']>

/** Compile-time proof that the structural adapter accepts the official Node SDK database. */
export function createStoreFromOfficialSdk(database: OfficialCloudBaseDatabase): CloudBaseSessionStore {
  return new CloudBaseSessionStore({ database })
}
