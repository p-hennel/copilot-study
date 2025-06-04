import { eq, and, like, inArray } from 'drizzle-orm';
import { area, area_authorization } from '$lib/server/db/base-schema';
import { AreaType } from '../../../types.js';
import type { DatabaseManager } from './database-manager.js';
import type { Area } from '../types/database.js';

/**
 * Database operations for Area table management
 * 
 * Provides:
 * - Area creation and metadata updates
 * - Authorization relationship management
 * - Namespace hierarchy handling
 * - Integration with GitLab namespaces
 */
export class AreaRepository {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Get or create an area
   */
  async getOrCreateArea(
    fullPath: string, 
    gitlabId: string, 
    name: string, 
    type: AreaType
  ): Promise<Area> {
    return await this.dbManager.withTransaction(async (db) => {
      // Try to find existing area first
      const [existingArea] = await db
        .select()
        .from(area)
        .where(eq(area.full_path, fullPath))
        .limit(1);

      if (existingArea) {
        // Update metadata if needed
        if (existingArea.name !== name || existingArea.gitlab_id !== gitlabId) {
          const [updatedArea] = await db
            .update(area)
            .set({
              name,
              gitlab_id: gitlabId
            })
            .where(eq(area.full_path, fullPath))
            .returning();
          
          return updatedArea as Area;
        }
        return existingArea as Area;
      }

      // Create new area
      const [newArea] = await db
        .insert(area)
        .values({
          full_path: fullPath,
          gitlab_id: gitlabId,
          name,
          type,
          created_at: new Date()
        })
        .returning();

      return newArea as Area;
    });
  }

  /**
   * Get area by full path
   */
  async getArea(fullPath: string): Promise<Area | null> {
    const db = this.dbManager.getDatabase();
    const [foundArea] = await db
      .select()
      .from(area)
      .where(eq(area.full_path, fullPath))
      .limit(1);

    return foundArea || null;
  }

  /**
   * Get area by GitLab ID
   */
  async getAreaByGitlabId(gitlabId: string): Promise<Area | null> {
    const db = this.dbManager.getDatabase();
    const [foundArea] = await db
      .select()
      .from(area)
      .where(eq(area.gitlab_id, gitlabId))
      .limit(1);

    return foundArea || null;
  }

  /**
   * Get areas by account authorization
   */
  async getAreasByAccount(accountId: string): Promise<Area[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select({
        full_path: area.full_path,
        gitlab_id: area.gitlab_id,
        name: area.name,
        type: area.type,
        created_at: area.created_at
      })
      .from(area)
      .innerJoin(area_authorization, eq(area.full_path, area_authorization.area_id))
      .where(eq(area_authorization.accountId, accountId));
  }

  /**
   * Get areas by type
   */
  async getAreasByType(type: AreaType): Promise<Area[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select()
      .from(area)
      .where(eq(area.type, type));
  }

  /**
   * Search areas by name pattern
   */
  async searchAreasByName(pattern: string): Promise<Area[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select()
      .from(area)
      .where(like(area.name, `%${pattern}%`));
  }

  /**
   * Get parent areas (for hierarchical namespaces)
   */
  async getParentAreas(fullPath: string): Promise<Area[]> {
    const db = this.dbManager.getDatabase();
    const pathParts = fullPath.split('/');
    const parentPaths: string[] = [];

    // Build parent paths: "group/subgroup/project" -> ["group", "group/subgroup"]
    for (let i = 1; i < pathParts.length; i++) {
      parentPaths.push(pathParts.slice(0, i).join('/'));
    }

    if (parentPaths.length === 0) {
      return [];
    }

    return await db
      .select()
      .from(area)
      .where(inArray(area.full_path, parentPaths));
  }

  /**
   * Get child areas (for hierarchical namespaces)
   */
  async getChildAreas(fullPath: string): Promise<Area[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select()
      .from(area)
      .where(like(area.full_path, `${fullPath}/%`));
  }

  /**
   * Create area authorization
   */
  async createAreaAuthorization(accountId: string, areaFullPath: string): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      // Check if authorization already exists
      const [existing] = await db
        .select()
        .from(area_authorization)
        .where(
          and(
            eq(area_authorization.accountId, accountId),
            eq(area_authorization.area_id, areaFullPath)
          )
        )
        .limit(1);

      if (!existing) {
        await db
          .insert(area_authorization)
          .values({
            accountId,
            area_id: areaFullPath
          });
      }
    });
  }

  /**
   * Remove area authorization
   */
  async removeAreaAuthorization(accountId: string, areaFullPath: string): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      await db
        .delete(area_authorization)
        .where(
          and(
            eq(area_authorization.accountId, accountId),
            eq(area_authorization.area_id, areaFullPath)
          )
        );
    });
  }

  /**
   * Get authorized accounts for an area
   */
  async getAuthorizedAccounts(areaFullPath: string): Promise<string[]> {
    const db = this.dbManager.getDatabase();
    const results = await db
      .select({
        accountId: area_authorization.accountId
      })
      .from(area_authorization)
      .where(eq(area_authorization.area_id, areaFullPath));

    return results.map(r => r.accountId);
  }

  /**
   * Check if account has access to area
   */
  async hasAreaAccess(accountId: string, areaFullPath: string): Promise<boolean> {
    const db = this.dbManager.getDatabase();
    const [result] = await db
      .select()
      .from(area_authorization)
      .where(
        and(
          eq(area_authorization.accountId, accountId),
          eq(area_authorization.area_id, areaFullPath)
        )
      )
      .limit(1);

    return !!result;
  }

  /**
   * Bulk create or update areas from discovery
   */
  async bulkUpsertAreas(areas: Array<{
    fullPath: string;
    gitlabId: string;
    name: string;
    type: AreaType;
  }>): Promise<Area[]> {
    return await this.dbManager.withTransaction(async (db) => {
      const results: Area[] = [];

      for (const areaData of areas) {
        const [existingArea] = await db
          .select()
          .from(area)
          .where(eq(area.full_path, areaData.fullPath))
          .limit(1);

        if (existingArea) {
          // Update existing
          const [updatedArea] = await db
            .update(area)
            .set({
              gitlab_id: areaData.gitlabId,
              name: areaData.name,
              type: areaData.type
            })
            .where(eq(area.full_path, areaData.fullPath))
            .returning();
          if (updatedArea)
            results.push(updatedArea);
        } else {
          // Create new
          const [newArea] = await db
            .insert(area)
            .values({
              full_path: areaData.fullPath,
              gitlab_id: areaData.gitlabId,
              name: areaData.name,
              type: areaData.type,
              created_at: new Date()
            })
            .returning();
          if (newArea)
            results.push(newArea);
        }
      }

      return results;
    });
  }

  /**
   * Delete area and its authorizations
   */
  async deleteArea(fullPath: string): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      // Delete authorizations first (due to foreign key constraints)
      await db
        .delete(area_authorization)
        .where(eq(area_authorization.area_id, fullPath));

      // Delete area
      await db
        .delete(area)
        .where(eq(area.full_path, fullPath));
    });
  }

  /**
   * Get area statistics
   */
  async getAreaStatistics(): Promise<AreaStatistics> {
    const db = this.dbManager.getDatabase();
    const areas = await db.select().from(area);

    const stats: AreaStatistics = {
      total: areas.length,
      by_type: {
        [AreaType.group]: 0,
        [AreaType.project]: 0
      }
    };

    areas.forEach(a => {
      stats.by_type[a.type as AreaType]++;
    });

    return stats;
  }
}

// Type definitions
interface AreaStatistics {
  total: number;
  by_type: Record<AreaType, number>;
}