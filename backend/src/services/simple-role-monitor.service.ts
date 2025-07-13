import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { DataService } from './data.service';
import { DiscordVerificationService } from './discord-verification.service';
import { VerificationEngine } from './verification-engine.service';
import { UserAddressService } from './user-address.service';

/**
 * SimpleRoleMonitorService
 * 
 * A lightweight approach to dynamic role management that integrates with existing systems.
 * Provides manual re-verification capabilities and basic monitoring without complex scheduling.
 * 
 * Key Features:
 * - **Manual Re-verification**: Triggered via Discord commands or admin interfaces
 * - **Lightweight Design**: No automatic scheduling, runs on-demand
 * - **Existing System Integration**: Works with current verification infrastructure
 * - **Role Cleanup**: Removes roles when holdings no longer meet criteria
 * - **Detailed Reporting**: Provides comprehensive results for verification actions
 * 
 * Use Cases:
 * - Admin-triggered re-verification campaigns
 * - User-requested role updates
 * - Periodic manual audits of role assignments
 * - Testing verification rules before automating
 * 
 * @example
 * ```typescript
 * // Manual re-verification
 * const result = await service.reverifyUser('123456789', 'server_abc');
 * console.log(`Verified: ${result.verified.length}, Revoked: ${result.revoked.length}`);
 * 
 * // Server-wide role audit
 * const serverResult = await service.reverifyServer('server_abc');
 * ```
 */
@Injectable()
export class SimpleRoleMonitorService {
  constructor(
    private readonly dbSvc: DbService,
    private readonly dataSvc: DataService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    private readonly verificationEngine: VerificationEngine,
    private readonly userAddressService: UserAddressService,
  ) {}

  /**
   * Manual re-verification for a specific user across all applicable rules
   * 
   * Performs comprehensive verification of a user's current holdings against
   * all verification rules for a specific Discord server. This method:
   * 
   * 1. Retrieves user's current role assignments and verification history
   * 2. Gets all active verification rules for the server
   * 3. Looks up user's current wallet address from verification records
   * 4. Verifies holdings against each rule's requirements
   * 5. Updates role assignments based on current holdings
   * 6. Provides detailed report of actions taken
   * 
   * @param userId - Discord user ID to re-verify
   * @param serverId - Discord server ID containing the rules
   * @returns Promise<ReverificationResult> - Detailed results of the re-verification process
   * 
   * @example
   * ```typescript
   * const result = await service.reverifyUser('123456789', 'server_abc123');
   * 
   * // Process results
   * if (result.verified.length > 0) {
   *   console.log(`Granted roles: ${result.verified.join(', ')}`);
   * }
   * if (result.revoked.length > 0) {
   *   console.log(`Removed roles: ${result.revoked.join(', ')}`);
   * }
   * if (result.errors.length > 0) {
   *   console.warn(`Errors occurred: ${result.errors.join(', ')}`);
   * }
   * ```
   */
  async reverifyUser(userId: string, serverId: string): Promise<{
    verified: string[],
    revoked: string[],
    errors: string[]
  }> {
    Logger.log(`🔍 Re-verifying user ${userId} in server ${serverId}`);
    
    const result = {
      verified: [] as string[],
      revoked: [] as string[],
      errors: [] as string[]
    };

    try {
      // Get user's current role assignments from the log table
      const userRoles = await this.dbSvc.getUserRoleHistory(userId, serverId);
      const rules = await this.dbSvc.getRoleMappings(serverId);
      
      // Get user's current address (you might need to add this method)
      const userAddress = await this.getUserLatestAddress(userId);
      if (!userAddress) {
        result.errors.push('No address found for user');
        return result;
      }

      // Check each rule against current holdings
      for (const rule of rules) {
        try {
          const matchingAssets = await this.dataSvc.checkAssetOwnershipWithCriteria(
            userAddress,
            rule.slug,
            rule.attribute_key,
            rule.attribute_value,
            rule.min_items || 1
          );

          const requiredMinItems = rule.min_items || 1;
          const currentlyQualifies = matchingAssets >= requiredMinItems;
          
          // Check if user currently has this role
          const hasRole = await this.checkUserHasRole(userId, serverId, rule.role_id);
          
          if (currentlyQualifies && !hasRole) {
            // User should have role but doesn't - grant it
            await this.grantRole(userId, serverId, rule, userAddress);
            result.verified.push(rule.role_name || rule.role_id);
            
          } else if (!currentlyQualifies && hasRole) {
            // User has role but shouldn't - revoke it
            await this.revokeRole(userId, serverId, rule.role_id);
            result.revoked.push(rule.role_name || rule.role_id);
            
          } else if (currentlyQualifies && hasRole) {
            // User has role and should have it - no action needed
            result.verified.push(rule.role_name || rule.role_id);
          }
          
        } catch (error) {
          Logger.error(`Error checking rule ${rule.id}:`, error.message);
          result.errors.push(`Rule ${rule.id}: ${error.message}`);
        }
      }

      Logger.log(`Re-verification complete for user ${userId}: ${result.verified.length} verified, ${result.revoked.length} revoked, ${result.errors.length} errors`);
      return result;
      
    } catch (error) {
      Logger.error('Failed to re-verify user:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Re-verify all users for a specific server (admin function)
   */
  async reverifyServer(serverId: string): Promise<{
    usersProcessed: number,
    totalVerified: number,
    totalRevoked: number,
    errors: string[]
  }> {
    Logger.log(`🔍 Re-verifying entire server ${serverId}`);
    
    const result = {
      usersProcessed: 0,
      totalVerified: 0,
      totalRevoked: 0,
      errors: [] as string[]
    };

    try {
      // Get all unique users who have had roles in this server
      const uniqueUsers = await this.getServerUniqueUsers(serverId);
      
      for (const userId of uniqueUsers) {
        result.usersProcessed++;
        try {
          const userResult = await this.reverifyUser(userId, serverId);
          result.totalVerified += userResult.verified.length;
          result.totalRevoked += userResult.revoked.length;
          result.errors.push(...userResult.errors);
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          Logger.error(`Error re-verifying user ${userId}:`, error.message);
          result.errors.push(`User ${userId}: ${error.message}`);
        }
      }

      Logger.log(`Server re-verification complete: ${result.usersProcessed} users processed`);
      return result;
      
    } catch (error) {
      Logger.error('Failed to re-verify server:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Get user's most recent verified address from user_wallets table
   */
  private async getUserLatestAddress(userId: string): Promise<string | null> {
    // Get all addresses for the user, they're returned in order of last_verified_at DESC
    const addresses = await this.userAddressService.getUserAddresses(userId);
    return addresses.length > 0 ? addresses[0] : null;
  }

  /**
   * Check if user currently has a specific role in Discord
   */
  private async checkUserHasRole(userId: string, serverId: string, roleId: string): Promise<boolean> {
    try {
      // You might need to add this method to DiscordVerificationService
      const member = await this.discordVerificationSvc.getGuildMember(serverId, userId);
      return member?.roles?.cache?.has(roleId) || false;
    } catch (error) {
      Logger.warn(`Could not check role for user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Grant a role to a user
   */
  private async grantRole(userId: string, serverId: string, rule: any, address: string): Promise<void> {
    try {
      const roleResult = await this.discordVerificationSvc.addUserRole(userId, rule.role_id, serverId, 'reverification', rule.id.toString());
      await this.dbSvc.logUserRole(userId, serverId, rule.role_id, null, null, rule.role_name);
      
      if (roleResult.wasAlreadyAssigned) {
        Logger.log(`✅ User ${userId} already had role ${rule.role_name || rule.role_id} (reverification)`);
      } else {
        Logger.log(`✅ Granted role ${rule.role_name || rule.role_id} to user ${userId} (reverification)`);
      }
    } catch (error) {
      Logger.error(`Failed to grant role ${rule.role_id} to user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Revoke a role from a user
   */
  private async revokeRole(userId: string, serverId: string, roleId: string): Promise<void> {
    try {
      // You'll need to add this method to DiscordVerificationService
      await this.discordVerificationSvc.removeUserRole(userId, serverId, roleId);
      Logger.log(`🚫 Revoked role ${roleId} from user ${userId}`);
    } catch (error) {
      Logger.error(`Failed to revoke role ${roleId} from user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all unique users who have had roles in a server
   */
  private async getServerUniqueUsers(serverId: string): Promise<string[]> {
    // You'll need to add this method to DbService
    return this.dbSvc.getServerUniqueUsers(serverId);
  }
}
