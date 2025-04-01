import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { mkConfig, generateCsv, download, type ConfigOptions } from "export-to-csv";
//import type { getAvailableJobs } from "./server/db/jobFactory";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeURL(url: string) {
  if (url.endsWith("/") && url.length > 1) url = url.substring(0, -1);
  return url;
}

type CSVbaseType = { [key: string | number]: number | string | boolean | null | undefined };
const csvConfig = mkConfig({ useKeysAsHeaders: true, fileExtension: "csv" });
export const downloadAsCSV = <T extends CSVbaseType>(data: T[], config?: ConfigOptions) => {
  const csv = generateCsv(csvConfig)(data);
  return download({
    ...csvConfig,
    ...config
  })(csv);
};

type FilterCB = <T extends CSVbaseType>(value: T, idx: number, arr: T[]) => T;

export const handleDownloadAsCSV = <T extends CSVbaseType>(
  data: T[],
  filter: FilterCB,
  config?: ConfigOptions
) => {
  return () => downloadAsCSV<T>(filter ? data.filter(filter) : data, config);
};

export const dynamicHandleDownloadAsCSV = <T extends CSVbaseType>(
  fn: () => T[],
  config?: ConfigOptions
) => {
  return () => downloadAsCSV<T>(fn(), config);
};


