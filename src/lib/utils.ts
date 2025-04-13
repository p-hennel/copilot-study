import { clsx, type ClassValue } from "clsx";
import { download, generateCsv, mkConfig, type ConfigOptions } from "export-to-csv";
import { getLogger } from "nodemailer/lib/shared";
import { twMerge } from "tailwind-merge";
import type { TokenProvider } from "./types";
//import type { getAvailableJobs } from "./server/db/jobFactory";

export interface ProviderCallback<T> {
  gitlabCloud?: () => T
  gitlabOnPrem?: () => T
  jiraCloud?: () => T
  jiraOnPrem?: () => T
}
export function forProvider<T = void>(provider: TokenProvider | string, cbs: ProviderCallback<T>, logger = getLogger()): T|undefined {
  switch (provider.toLowerCase()) {
    case "gitlab-onprem":
    case "gitlabonprem":
      return cbs.gitlabOnPrem?.()
    case "gitlab":
    case "gitlabcloud":
    case "gitlab-cloud":
      return cbs.gitlabCloud?.()
    case "jiralocal":
    case "jira":
      return cbs.jiraOnPrem?.()
    case "jiracloud":
      return cbs.jiraCloud?.()
    default:
      logger.warn("No base URL found for provider {provider}", { provider })
      return undefined
  }
}

export function uniqueFilter<T>(value: T, index: number, self: T[]) {
  return self.indexOf(value) === index;
}

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


