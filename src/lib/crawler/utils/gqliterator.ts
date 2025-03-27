import type { Logger } from "@logtape/logtape";
import { getCaller } from "../../logging";
import type { Client } from "@urql/core";
import type { DocumentNode } from "graphql";

// Define a generic type to extract nodes from the GraphQL query result.
// This type infers the shape of the nodes based on the response structure.
type QueryResultType<Result extends object> = "nodes" extends keyof Result
  ? Result["nodes"] extends (infer Nodes)[]
    ? " $fragmentRefs" extends keyof Nodes
      ? Nodes[" $fragmentRefs"][keyof Nodes[" $fragmentRefs"]]
      : Nodes[keyof Nodes]
    : Result["nodes"]
  : {
      [Keys in keyof Omit<Result, "prev" | "next">]: QueryResultType<Extract<Result[Keys], object>>;
    }[keyof Omit<Result, "prev" | "next">];

/**
 * iterate - Iterates through all pages of a GraphQL query using cursor-based pagination.
 * 
 * @param _logger - Logger instance for logging messages.
 * @param client - GraphQL client used to execute queries.
 * @param keys - The key(s) to extract data from the response.
 * @param query - The GraphQL query to execute.
 * @param params - Parameters to pass to the query.
 * @param enhance - Optional function to enhance/transform each result item.
 * @param iterationCB - Optional callback function that gets called after each iteration with the current batch of results.
 */
export async function iterate<
  QueryType extends DocumentNode,
  ResultType = QueryResultType<QueryType>
>(
  _logger: Logger,
  client: Client,
  keys: string | string[],
  query: QueryType,
  params: any = {},
  enhance?: (obj: ResultType) => Promise<void> | void,
  iterationCB?: (result: ResultType[]) => Promise<void> | void
): Promise<void> {
  // Create a scoped logger with contextual information
  const logger = _logger.with({ caller: getCaller(iterate), keys });
  let total = 0; // Track total items processed
  try {
    let after: string | null = null; // Cursor for pagination
    do {
      // Execute the query with the current cursor
      const response = await client.query(query, { ...params, after });
      if (!!response.error || !response.data) {
        logger.error("query failed!", { response, after });
        return;
      }
      // Extract data using the provided keys
      const data = extract(logger, response.data, keys);
      if (!data || !data.nodes) {
        logger.error("could not extract!", { data: response.data, keys, after });
        return;
      }
      let items: ResultType[] = data.nodes;
      if (enhance) {
        // Optionally enhance each item concurrently
        logger.debug("enhancing: {enhance}", { enhance });
        await Promise.all(items.map(enhance));
      } else {
        logger.debug("received: {count}", { count: items.length });
      }
      // Update cursor for the next iteration
      after = getEndCursor(data);
      total += items.length;
      logger.debug("completed iteration", () => ({ after, total, added: items.length }));
      // Call the iteration callback if provided
      if (iterationCB) {
        await iterationCB(items);
      }
    } while (!!after); // Continue while there's a next page

    logger.debug("completed iterations", () => ({ total }));
  } catch (error: any) {
    logger.error("ITERATE FAILED: {message}\n{stack}\n---", {
      message: error.message,
      stack: error.stack,
      query,
      params
    });
  }
}

/**
 * iterateOverOffset - Iterates over paginated data using offset-based pagination.
 * This function aggregates all records into a single array.
 * 
 * @param _logger - Logger instance for logging messages.
 * @param client - GraphQL client used to execute queries.
 * @param keys - The key(s) to extract data from the response.
 * @param query - The GraphQL query to execute.
 * @param params - Parameters to pass to the query.
 * @param limit - The number of records to fetch per query (default is 25).
 * @returns An array of all aggregated results.
 */
export async function iterateOverOffset<
  QueryType extends DocumentNode,
  ResultType = QueryResultType<QueryType>
>(
  _logger: Logger,
  client: Client,
  keys: string | string[],
  query: QueryType,
  params: any = {},
  limit: number = 25
): Promise<ResultType[]> {
  const logger = _logger.with({ caller: getCaller(iterate), keys });
  // Ensure keys is always an array (shallow copy for safety)
  keys = Array.isArray(keys) ? [...keys] : [keys];
  const result: ResultType[] = [];
  let offset = 0;
  while (true) {
    // Build query arguments including offset and limit for pagination
    const queryArgs = { ...params, offset, limit };
    const response = await client.query(query, queryArgs);
    if (response.error || !response.data) {
      logger.error("query failed!", { response, queryArgs });
      break;
    }
    // Extract data using keys
    const data = extract(logger, response.data, [...keys]);
    // Ensure data is an array; if not, use an empty array
    const _data: ResultType[] = Array.isArray(data) ? data : [];
    if (_data.length === 0) break;
    // Append the fetched items and update offset
    result.push(..._data);
    offset += _data.length;
    logger.debug("completed iteration", () => ({
      offset,
      total: result.length,
      added: _data.length
    }));
    // If fewer records than limit were returned, assume no more pages exist
    if (_data.length < limit) break;
  }

  logger.debug("completed iterations", () => ({ total: result.length }));
  return result;
}

/**
 * _getPageInfo - Helper function to extract page information from the response.
 * If the object contains 'pageInfo' or cursor-related properties, returns a standardized PageInfo object.
 * 
 * @param data - The response data from the GraphQL query.
 * @returns A standardized PageInfo object or undefined if not applicable.
 */
const _getPageInfo = (data: object | undefined): PageInfo | undefined => {
  if (!data) return undefined;
  if (data.hasOwnProperty("pageInfo")) return (data as PageInfoContainer).pageInfo;
  if (data.hasOwnProperty("endCursor") || data.hasOwnProperty("hasNextPage")) {
    return {
      endCursor: null,
      hasNextPage: null,
      ...data
    };
  }
  return undefined;
};

/**
 * hasMore - Determines if there are more pages to be fetched based on the PageInfo.
 * 
 * @param data - The PageInfo or similar object.
 * @returns True if there are more pages; otherwise, false.
 */
export const hasMore = (data: HasMore | PageInfo | PageInfoContainer | undefined): boolean => {
  data = _getPageInfo(data);
  if (data?.hasNextPage !== undefined && data.hasNextPage !== null) {
    return data.hasNextPage;
  }
  return false;
};

/**
 * getEndCursor - Retrieves the endCursor from the PageInfo.
 * 
 * @param data - The PageInfo or similar object.
 * @returns The endCursor string or null if not available.
 */
export const getEndCursor = (
  data: EndCursor | PageInfo | PageInfoContainer | undefined
): string | null => {
  data = _getPageInfo(data);
  return data?.endCursor !== undefined ? data.endCursor : null;
};

// Define types related to pagination info.
type PageInfoContainer = {
  pageInfo: {
    endCursor: string | null | undefined;
    hasNextPage: boolean | null | undefined;
  };
};
type PageInfo = PageInfoContainer["pageInfo"];
type EndCursor = Omit<PageInfo, "hasNextPage">;
type HasMore = Omit<PageInfo, "endCursor">;

/**
 * extract - Recursively extracts a nested value from an object using the provided keys.
 * This function supports dynamic adaptation if keys are not directly present in the object.
 * 
 * @param logger - Logger instance for logging warnings and debug information.
 * @param obj - The object from which to extract the value.
 * @param keys - A single key or an array of keys defining the extraction path.
 * @param tryReverse - A flag to attempt reversing keys if the initial key is not found.
 * @returns The extracted value, or undefined if extraction fails.
 */
function extract(logger: Logger, obj: any, keys: string | string[], tryReverse = true): any {
  // Create a shallow copy of keys if it's an array to avoid side-effects
  if (Array.isArray(keys)) {
    keys = [...keys];
  }

  if (!obj) {
    logger.warn("extracting from non-object obj ({obj}), called by: {caller}", {
      obj,
      caller: getCaller(extract),
      stack: new Error().stack
    });
    return undefined;
  }

  // If no keys provided, return the original object
  if (!keys) return obj;
  if (!Array.isArray(keys)) {
    if (typeof keys === "string") keys = [keys];
    else return obj;
  } else if (keys.length <= 0) return obj;

  // Get all keys from the object
  const objKeys = Object.keys(obj);
  // Retrieve the first key from the keys array
  let key = keys.shift();

  // If tryReverse flag is set and the key is not found, attempt to reverse the keys order
  if (tryReverse && !!key && !objKeys.includes(key)) {
    keys.unshift(key);
    key = keys.pop();
    if (!!key && objKeys.includes(key)) {
      keys.push(key);
      keys.reverse();
      key = keys.shift();
    }
  }

  if (!!key) {
    // If the key exists in the object, extract its value
    if (objKeys.includes(key)) {
      const value = obj[key];
      // If more keys remain, recursively extract the nested value
      if (keys.length > 0) {
        return extract(logger, value, keys, false);
      } else {
        return value;
      }
    }

    // If the key is not found, but the object contains a "data" field, adapt dynamically
    if (objKeys.includes("data") && !!obj["data"]) {
      logger.debug('Key ({key}) not present in object, but "data". Adapting dynamically.', {
        key,
        objKeys
      });
      if (!keys.includes(key)) keys.unshift(key);
      return extract(logger, obj["data"], keys);
    }
  }

  // If keys remain and no match is found, log a warning and attempt to continue extraction
  if (keys.length > 0) {
    logger.warn(`Key ({key}) not present in object. Continuing with remaining keys (${keys.join(", ")})`, { key, obj });
    return extract(logger, obj, keys);
  } else {
    logger.warn("Extraction failed, all keys exhausted but no match", { obj, key, keys });
    return undefined;
  }
}
