import { describe, it, expect } from 'bun:test';
import { buildJobsApiUrl, parseJobsApiParams } from '$lib/types/jobs-api';
import { JobStatus, CrawlCommand } from '$lib/types';

describe('Jobs API Utilities', () => {
  const baseUrl = 'http://localhost:5173';

  describe('buildJobsApiUrl', () => {
    it('should build basic URL with default parameters', () => {
      const url = buildJobsApiUrl(baseUrl, {});
      expect(url).toBe('http://localhost:5173/api/admin/jobs');
    });

    it('should include pagination parameters', () => {
      const url = buildJobsApiUrl(baseUrl, { page: 2, limit: 50 });
      expect(url).toContain('page=2');
      expect(url).toContain('limit=50');
    });

    it('should include sorting parameters', () => {
      const url = buildJobsApiUrl(baseUrl, { sortBy: 'status', sortOrder: 'asc' });
      expect(url).toContain('sortBy=status');
      expect(url).toContain('sortOrder=asc');
    });

    it('should handle multiple command filters', () => {
      const url = buildJobsApiUrl(baseUrl, { 
        command: [CrawlCommand.issues, CrawlCommand.users] 
      });
      expect(url).toContain('command=issues%2Cusers');
    });

    it('should handle multiple status filters', () => {
      const url = buildJobsApiUrl(baseUrl, { 
        status: [JobStatus.finished, JobStatus.failed] 
      });
      expect(url).toContain('status=finished%2Cfailed');
    });

    it('should include boolean filters', () => {
      const url = buildJobsApiUrl(baseUrl, { 
        hasStarted: true, 
        hasFinished: false,
        hasParent: true
      });
      expect(url).toContain('hasStarted=true');
      expect(url).toContain('hasFinished=false');
      expect(url).toContain('hasParent=true');
    });

    it('should include search parameters', () => {
      const url = buildJobsApiUrl(baseUrl, { 
        search: 'gitlab-org',
        dateSearch: '2024-01',
        dateField: 'started'
      });
      expect(url).toContain('search=gitlab-org');
      expect(url).toContain('dateSearch=2024-01');
      expect(url).toContain('dateField=started');
    });

    it('should build complex URL with all parameters', () => {
      const url = buildJobsApiUrl(baseUrl, {
        page: 3,
        limit: 10,
        sortBy: 'finished',
        sortOrder: 'asc',
        command: [CrawlCommand.issues, CrawlCommand.mergeRequests],
        status: JobStatus.finished,
        hasStarted: true,
        hasFinished: true,
        hasParent: false,
        search: 'test-project',
        dateSearch: '2024-01-15',
        dateField: 'created'
      });
      
      expect(url).toContain('page=3');
      expect(url).toContain('limit=10');
      expect(url).toContain('sortBy=finished');
      expect(url).toContain('sortOrder=asc');
      expect(url).toContain('command=issues%2CmergeRequests');
      expect(url).toContain('status=finished');
      expect(url).toContain('hasStarted=true');
      expect(url).toContain('hasFinished=true');
      expect(url).toContain('hasParent=false');
      expect(url).toContain('search=test-project');
      expect(url).toContain('dateSearch=2024-01-15');
      // dateField=created is default, so it might not be included
    });
  });

  describe('parseJobsApiParams', () => {
    it('should parse empty search params', () => {
      const searchParams = new URLSearchParams();
      const params = parseJobsApiParams(searchParams);
      expect(params).toEqual({});
    });

    it('should parse pagination parameters', () => {
      const searchParams = new URLSearchParams('page=2&limit=50');
      const params = parseJobsApiParams(searchParams);
      expect(params.page).toBe(2);
      expect(params.limit).toBe(50);
    });

    it('should parse sorting parameters', () => {
      const searchParams = new URLSearchParams('sortBy=status&sortOrder=asc');
      const params = parseJobsApiParams(searchParams);
      expect(params.sortBy).toBe('status');
      expect(params.sortOrder).toBe('asc');
    });

    it('should parse single command filter', () => {
      const searchParams = new URLSearchParams('command=issues');
      const params = parseJobsApiParams(searchParams);
      expect(params.command).toBe(CrawlCommand.issues);
    });

    it('should parse multiple command filters', () => {
      const searchParams = new URLSearchParams('command=issues,users');
      const params = parseJobsApiParams(searchParams);
      expect(params.command).toEqual([CrawlCommand.issues, CrawlCommand.users]);
    });

    it('should parse boolean filters', () => {
      const searchParams = new URLSearchParams('hasStarted=true&hasFinished=false&hasParent=true');
      const params = parseJobsApiParams(searchParams);
      expect(params.hasStarted).toBe(true);
      expect(params.hasFinished).toBe(false);
      expect(params.hasParent).toBe(true);
    });

    it('should parse search parameters', () => {
      const searchParams = new URLSearchParams('search=gitlab-org&dateSearch=2024-01&dateField=started');
      const params = parseJobsApiParams(searchParams);
      expect(params.search).toBe('gitlab-org');
      expect(params.dateSearch).toBe('2024-01');
      expect(params.dateField).toBe('started');
    });

    it('should handle round-trip conversion', () => {
      const originalParams = {
        page: 2,
        limit: 30,
        sortBy: 'finished' as const,
        sortOrder: 'asc' as const,
        command: [CrawlCommand.issues, CrawlCommand.users],
        status: JobStatus.finished,
        hasStarted: true,
        search: 'test',
        dateSearch: '2024-01-15',
        dateField: 'created' as const
      };
      
      const url = buildJobsApiUrl(baseUrl, originalParams);
      const searchParams = new URL(url).searchParams;
      const parsedParams = parseJobsApiParams(searchParams);
      
      expect(parsedParams.page).toBe(originalParams.page);
      expect(parsedParams.limit).toBe(originalParams.limit);
      expect(parsedParams.sortBy).toBe(originalParams.sortBy);
      expect(parsedParams.sortOrder).toBe(originalParams.sortOrder);
      expect(parsedParams.command).toEqual(originalParams.command);
      expect(parsedParams.status).toBe(originalParams.status);
      expect(parsedParams.hasStarted).toBe(originalParams.hasStarted);
      expect(parsedParams.search).toBe(originalParams.search);
      expect(parsedParams.dateSearch).toBe(originalParams.dateSearch);
    });
  });
});