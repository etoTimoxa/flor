export { getCloudSyncInfo, isCloudSyncEnabled } from './cloud'

export async function flushCloudPush() {
  // Writes now go to S3 in the CRUD helpers themselves.
}
