import { Injectable, Logger } from '@nestjs/common';
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { formatAttribute } from '../utils/rule-validation.util';

/**
 * List Rules Command Handler
 * 
 * Handles the complete flow for listing verification rules:
 * - Retrieval of all server rules
 * - Filtering and sorting by rule ID
 * - Formatted display with channel/role references
 * - Proper handling of empty rule sets
 */
@Injectable()
export class ListRulesHandler {
  private readonly logger = new Logger(ListRulesHandler.name);

  constructor(
    private readonly dbSvc: DbService
  ) {}

  /**
   * Main entry point for list rules command
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Defer the reply early to prevent timeout
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      // Get all verification rules for the server
      const allRules = await this.dbSvc.getRoleMappings(interaction.guild.id);
      const rules = this.filterAndSortRules(allRules);
      
      // Format and send the rules list
      const description = this.formatRulesList(rules);
      
      await interaction.editReply({
        embeds: [AdminFeedback.info('Verification Rules', description)]
      });

    } catch (error) {
      this.logger.error('Error in handleListRules:', error);
      
      const errorMessage = `Error retrieving rules: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply({
          content: AdminFeedback.simple(errorMessage, true)
        });
      } else {
        await interaction.reply({
          content: AdminFeedback.simple(errorMessage, true),
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }

  /**
   * Filters out system rules and sorts by rule ID
   */
  private filterAndSortRules(allRules: any[]): any[] {
    return allRules
      .filter(rule => rule.server_id !== '000000000000000000')
      .sort((a, b) => a.id - b.id); // Sort by Rule ID in ascending order
  }

  /**
   * Formats the rules list for display
   */
  private formatRulesList(rules: any[]): string {
    if (rules.length === 0) {
      return 'No verification rules found.';
    }

    return rules.map(rule => this.formatSingleRule(rule)).join('\n\n');
  }

  /**
   * Formats a single rule for display
   */
  private formatSingleRule(rule: any): string {
    const attribute = formatAttribute(rule.attribute_key, rule.attribute_value);
    const slug = rule.slug || 'ALL';
    const minItems = rule.min_items || 1;

    return `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
  }
}
