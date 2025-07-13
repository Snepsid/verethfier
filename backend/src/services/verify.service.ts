import { Injectable, Logger } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { NonceService }  from './nonce.service';
import { DiscordService } from './discord.service';
import { DiscordVerificationService } from './discord-verification.service';
import { DataService }   from './data.service';
import { DbService }     from './db.service';
import { VerificationService } from './verification.service';
import { DecodedData }   from '@/models/app.interface';
import { matchRule }   from './utils/match-rule.util';

/**
 * VerifyService
 * 
 * Core verification service that handles the complete wallet signature verification flow.
 * Supports both message-based verification (new rule system) and legacy server-based verification.
 * 
 * Flow:
 * 1. Verifies wallet signature using viem/ethers
 * 2. Validates and invalidates nonce to prevent replay attacks
 * 3. Checks asset ownership against verification rules
 * 4. Assigns Discord roles based on matching criteria
 * 
 * The service supports two verification paths:
 * - Message-based: Uses specific message/channel rules (preferred)
 * - Legacy: Uses server-wide role assignments (deprecated)
 */
@Injectable()
export class VerifyService {
  constructor(
    private readonly walletSvc: WalletService,
    private readonly nonceSvc: NonceService,
    private readonly discordSvc: DiscordService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    private readonly dataSvc: DataService,
    private readonly dbSvc: DbService,
    private readonly verificationSvc: VerificationService,
  ) {}

  /**
   * Main verification flow that handles wallet signature verification and role assignment.
   * 
   * This method supports two verification modes:
   * 1. Message-based verification: Uses rules associated with a specific Discord message
   * 2. Legacy verification: Uses server-wide role assignments (deprecated)
   * 
   * @param payload - Decoded JWT payload containing user and server information
   * @param signature - Wallet signature to verify
   * @returns Promise<{message: string, address: string}> - Verification result
   * @throws Error if verification fails at any step
   */
  async verifySignatureFlow(
    payload: DecodedData & { address?: string },
    signature: string
  ) {
    // Verify the wallet signature and extract the signing address
    const address = await this.walletSvc.verifySignature(payload, signature);
    
    // Get the message data associated with the nonce for message-based verification
    const { messageId, channelId } = await this.nonceSvc.getNonceData(payload.userId);
    
    // Invalidate the nonce after retrieving the data to prevent replay attacks
    await this.nonceSvc.invalidateNonce(payload.userId);
    Logger.debug(`Nonce deleted for userId: ${payload.userId}`);

    // --- Channel-based verification (simplified approach) ---
    // Get all rules for the channel where the verification button was clicked
    if (channelId) {
      Logger.debug(`Channel-based verification for channelId: ${channelId}`);
      
      // Get ALL rules that apply to this channel
      const rules = await this.verificationSvc.getRulesForChannel(
        payload.discordId,
        channelId
      );
      
      if (!rules || rules.length === 0) {
        Logger.warn(`No rules found for channelId: ${channelId}`);
        const errorMsg = 'No verification rules found for this channel';
        await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
        throw new Error(errorMsg);
      }

      Logger.debug(`Found ${rules.length} rules for channelId: ${channelId}`);
      
      // Use the unified verification engine to verify the user against all rules
      const ruleIds = rules.map(rule => rule.id);
      const verificationResult = await this.verificationSvc.verifyUserBulk(payload.userId, ruleIds, address);
      const { validRules, invalidRules, matchingAssetCounts } = verificationResult;
      
      const roleResults = [];
      let hasMatchingAssets = validRules.length > 0;
      
      for (const rule of validRules) {
        if (!rule.role_id) {
          Logger.warn(`Rule ${rule.id} has no role_id, skipping`);
          continue;
        }
        
        const assetCount = matchingAssetCounts.get(rule.id.toString()) || 0;
        Logger.debug(`Processing valid rule ${rule.id}: ${assetCount} matching assets`);
        
        try {
          Logger.debug(`Assigning role: ${rule.role_id} to user: ${payload.userId}`);
          
          // Get user, guild, and role information for logging (with fallbacks)
          let user = null, guild = null, role = null;
          try {
            [user, guild, role] = await Promise.all([
              this.discordSvc.getUser(payload.userId),
              this.discordSvc.getGuild(payload.discordId),
              this.discordSvc.getRole(payload.discordId, rule.role_id)
            ]);
          } catch (discordError) {
            Logger.warn(`Discord API calls failed for role assignment:`, discordError.message);
          }
          
          const roleResult = await this.discordVerificationSvc.addUserRole(
            payload.userId,
            rule.role_id,
            payload.discordId,
            payload.nonce,
            rule.id.toString() // Pass the rule ID for proper tracking
          );

          // Role assignment and tracking is handled by assignRole() method
          // No need for additional tracking here

          if (roleResult) {
            roleResults.push(roleResult);
          }
          Logger.debug(`✅ Role assigned for rule ${rule.id} (${rule.slug})`);
        } catch (error) {
          Logger.error(`❌ Failed to assign role ${rule.role_id}:`, error.message);
          // Continue with other roles even if one fails - don't add to roleResults
        }
      }
      
      if (!hasMatchingAssets) {
        const errorMsg = rules[0]?.slug 
          ? `Address does not own the required assets for collection: ${rules[0].slug}`
          : 'Address does not own any assets in the collection';
        await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
        throw new Error(errorMsg);
      }
      
      // Send verification complete message with role assignment details
      try {
        await this.discordVerificationSvc.sendVerificationComplete(
          payload.discordId,
          payload.nonce,
          roleResults
        );
      } catch (error) {
        Logger.error('Failed to send verification complete message:', error);
        // Log the error but don't fail the verification process
      }
      
      const totalAssigned = roleResults.length;
      const newlyAssigned = roleResults.filter(r => !r.wasAlreadyAssigned).length;
      
      Logger.log(`✅ User verification completed (${newlyAssigned} new roles, ${totalAssigned - newlyAssigned} existing roles)`);
      return { 
        message: `Verification successful (message-based) - ${newlyAssigned} new roles assigned, ${totalAssigned - newlyAssigned} existing roles`, 
        address,
        assignedRoles: roleResults.map(r => r.roleId)
      };
    }

    // --- Unified verification path ---
    // This path handles all cases: legacy rules, modern rules, and mixed scenarios
    // The VerificationEngine automatically detects rule types and applies appropriate logic
    Logger.debug(`Unified verification path for address: ${address}`);
    
    // Get all rules for the current guild using the unified verification service
    const rules = await this.verificationSvc.getAllRulesForServer(payload.discordId);
    
    if (!rules || rules.length === 0) {
      const errorMsg = 'No verification rules found for this server';
      await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
      throw new Error(errorMsg);
    }
    
    // Use unified verification engine to check all rules (both legacy and modern)
    const ruleIds = rules.map(rule => rule.id);
    const verificationResult = await this.verificationSvc.verifyUserBulk(payload.userId, ruleIds, address);
    const { validRules, matchingAssetCounts } = verificationResult;
    
    if (validRules.length === 0) {
      const errorMsg = 'Address does not meet any verification requirements';
      await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
      throw new Error(errorMsg);
    }

    const roleResults = [];
    for (const rule of validRules) {
      const assetCount = matchingAssetCounts.get(rule.id.toString()) || 0;
      Logger.debug(`Unified verification: Assigning role ${rule.role_id} for rule ${rule.id}: ${assetCount} matching assets`);
      
      try {
        const roleResult = await this.discordVerificationSvc.addUserRole(
          payload.userId,
          rule.role_id,
          payload.discordId,
          payload.nonce,
          rule.id.toString() // Pass the rule ID for proper tracking
        );

        // Role assignment and tracking is handled by addUserRole() method
        // No need for additional tracking here

        if (roleResult) {
          roleResults.push(roleResult);
        }
        Logger.debug(`✅ Unified verification: Successfully assigned role: ${rule.role_id} for rule ${rule.id}`);
      } catch (error) {
        Logger.error(`❌ Failed to assign role ${rule.role_id} for rule ${rule.id}:`, error.message);
        // Continue with other roles even if one fails - don't add to roleResults
      }
    }
    
    // Send verification complete message with role assignment details
    try {
      await this.discordVerificationSvc.sendVerificationComplete(
        payload.discordId,
        payload.nonce,
        roleResults
      );
    } catch (error) {
      Logger.error('Failed to send verification complete message:', error);
      // Log the error but don't fail the verification process
    }
    
    const totalAssigned = roleResults.length;
    const newlyAssigned = roleResults.filter(r => !r.wasAlreadyAssigned).length;
    
    Logger.log(`✅ Unified verification completed (${newlyAssigned} new roles, ${totalAssigned - newlyAssigned} existing roles)`);
    return { 
      message: `Verification successful - ${newlyAssigned} new roles assigned, ${totalAssigned - newlyAssigned} existing roles`, 
      address, 
      assignedRoles: roleResults.map(r => r.roleId)
    };
  }
}
