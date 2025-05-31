import { parseArgs } from "util";
import { computeHash } from "./server/CryptoHash"; // Corrected import path and name
import type { SupportedCryptoAlgorithms } from "bun";
import path from "node:path";
import { transform } from "stream-transform";
import * as csvParse from "csv-parse";
import * as csvStringify from "csv-stringify";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["app"]);

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    algorithm: {
      type: "string",
      short: "a",
      multiple: false,
      default: "sha256"
    },
    key: {
      type: "string",
      short: "k",
      multiple: false,
      default: "eaSKwKpne72488xYMTcmoq5gQc8GmcXESKfJsj6k6zppQ3KwuAb4oaLzdW3e7Pea"
    },
    hashColumn: {
      type: "string",
      short: "c",
      multiple: false,
      default: "mailHash"
    },
    delimiter: {
      type: "string",
      short: "d",
      multiple: false,
      default: ","
    },
    escape: {
      type: "string",
      short: "x",
      multiple: false,
      default: '"'
    },
    encoding: {
      type: "string",
      short: "e",
      multiple: false,
      default: "utf-8"
    }
  },
  strict: true,
  allowPositionals: true
});

async function getTargetPath(sourcePath: string, iteration: number = 1) {
  const extension = path.extname(sourcePath);
  const targetCandidatePath = path.join(
    path.dirname(sourcePath),
    `${path.basename(sourcePath, extension)}-${iteration.toString().padStart(3, "0")}${extension}`
  );

  const targetCandidateFile = Bun.file(targetCandidatePath);
  if (await targetCandidateFile.exists()) return getTargetPath(sourcePath, iteration + 1);
  else
    return {
      targetPath: targetCandidatePath,
      targetFile: targetCandidateFile
    };
}

const candidates = ["email", "e-mail", "e.mail", "mail"].map((x) => x.toLowerCase());
function getEmailColumn(record: object) {
  const _keys = Object.keys(record);
  const keys = _keys.map((x) => x.toLowerCase());
  const foundIndex = candidates.map((x) => keys.indexOf(x)).filter((x) => x >= 0);
  if (foundIndex.length <= 0) {
    logger.error("Could not find email address in keys!");
    process.exit(4);
  }
  return _keys[Math.min(...foundIndex)];
}

let _sourcePath: string = "";
if (positionals.length !== 3) {
  process.stdout.write("Please enter the path to the source CSV: ");
  for await (const line of console) {
    _sourcePath = line;
    if (_sourcePath.startsWith("'") || _sourcePath.startsWith('"'))
      _sourcePath = _sourcePath.substring(1);
    if (_sourcePath.endsWith("'") || _sourcePath.endsWith('"'))
      _sourcePath = _sourcePath.substring(0, _sourcePath.length - 1);
    break;
  }
  //logger.error("Need exactly one argument: path to source CSV.")
  //process.exit(1);
} else {
  if (positionals[2] === undefined) {
    logger.error("Error: Missing required source CSV file path argument.");
    process.exit(1);
  }
  _sourcePath = positionals[2];
}

if (!path.isAbsolute(_sourcePath) && !_sourcePath.startsWith("/"))
  _sourcePath = path.resolve(_sourcePath);
const sourcePath = _sourcePath;
const sourceFile = Bun.file(sourcePath);
if (!(await sourceFile.exists())) {
  logger.error(`Source file does not exist: ${sourcePath}`);
  process.exit(2);
}

const extension = path.extname(sourcePath);
if (extension.toLowerCase() !== ".csv") {
  logger.error(`Source file is not a CSV-file: ${sourcePath} (${extension})`);
  process.exit(3);
}

const { targetPath, targetFile } = await getTargetPath(sourcePath);
logger.info("Will write to {targetPath}", { targetPath });

const targetWriter = targetFile.writer();

const parseOptions: csvParse.Options = {
  delimiter: values.delimiter,
  escape: values.escape,
  encoding: values.encoding as BufferEncoding,
  columns: true
};
const serializeOptions: csvStringify.Options = {
  delimiter: values.delimiter,
  escape: values.escape,
  encoding: values.encoding as BufferEncoding,
  header: true
};

const nodeTranslator = new WritableStream({
  start() {},
  write(value) {
    parser.write(value);
  },
  close() {
    parser.end();
  }
});

const parser = csvParse.parse(parseOptions);
parser.on("error", function (err: any) {
  logger.error("Parser:", err);
});

let emailColumn: string | undefined;
const transformer = transform<any, any>((record, callback) => {
  if (!emailColumn) emailColumn = getEmailColumn(record);

  // If email column couldn't be determined, skip this record
  if (!emailColumn) {
    logger.warn("Could not determine email column for record, skipping:", record);
    return callback(); // Skip record
  }

  record[values.hashColumn] = computeHash(
    record[emailColumn], // Now emailColumn is guaranteed to be a string here
    values.key,
    values.algorithm as SupportedCryptoAlgorithms
  );
  callback(undefined, record);
});
transformer.on("error", function (err) {
  logger.error("Transformer: {error}", { error: err });
});

const stringifier = csvStringify.stringify(serializeOptions);
stringifier.on("error", function (err) {
  logger.error("Serializer: {error}", { error: err });
});

const writer = transform<any, any>(async (record, callback) => {
  await targetWriter.write(record);
  callback();
});
writer.on("error", function (err) {
  logger.error("Writer: {error}", { error: err });
});

const piping = parser.pipe(transformer).pipe(stringifier).pipe(writer);

const finishedWriting = new Promise<void>((resolve, reject) => {
  piping.on("finish", function () {
    piping.end();
    resolve();
  });
  piping.on("error", function (err) {
    logger.error("Piping: {error}", { error: err });
    reject(err);
  });
});

await sourceFile.stream().pipeTo(nodeTranslator);
await finishedWriting;
