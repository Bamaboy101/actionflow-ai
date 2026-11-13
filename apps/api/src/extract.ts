/**
 * Single source of truth: the extraction used by the live API.
 * Re-exported here so unit tests exercise exactly the production code path.
 */
export { extractDeterministic, extractDeterministic as parseInput } from './index'
