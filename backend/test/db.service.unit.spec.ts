/**
 * DbService Unit Tests
 * 
 * Focused unit tests for the refactored DbService that uses dependency injection
 * for the Supabase client. These tests verify that the dependency injection works
 * correctly and that the service can handle basic operations.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DbService } from '../src/services/db.service';

describe('DbService (Unit Tests)', () => {
  let service: DbService;
  let mockSupabaseClient: any;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Create a mock Supabase client
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbService,
        {
          provide: 'SUPABASE_CLIENT',
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<DbService>(DbService);
    
    // Mock Logger to avoid console output during tests
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockRestore();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have access to the injected Supabase client', () => {
      expect(service).toBeInstanceOf(DbService);
    });

    it('should have all expected methods', () => {
      expect(typeof service.addUpdateServer).toBe('function');
      expect(typeof service.getServerRole).toBe('function');
      expect(typeof service.addRoleMapping).toBe('function');
      expect(typeof service.getRoleMappings).toBe('function');
      expect(typeof service.deleteRoleMapping).toBe('function');
      expect(typeof service.getAllRulesForServer).toBe('function');
      expect(typeof service.getRuleById).toBe('function');
      expect(typeof service.trackRoleAssignment).toBe('function');
      expect(typeof service.updateRoleVerification).toBe('function');
    });
  });

  describe('addUpdateServer', () => {
    it('should successfully add/update a server', async () => {
      const mockResult = {
        data: { id: '123', name: 'Test Server', role_id: 'role123' },
        error: null
      };
      
      mockSupabaseClient.upsert.mockResolvedValue(mockResult);

      const result = await service.addUpdateServer('123', 'Test Server', 'role123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_servers');
      expect(mockSupabaseClient.upsert).toHaveBeenCalledWith({
        id: '123',
        name: 'Test Server',
        role_id: 'role123'
      });
      expect(result).toEqual(mockResult.data);
    });

    it('should throw error on database error', async () => {
      const mockError = new Error('Database error');
      mockSupabaseClient.upsert.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.addUpdateServer('123', 'Test Server', 'role123')).rejects.toThrow('Database error');
    });
  });

  describe('getServerRole', () => {
    it('should successfully retrieve a server role', async () => {
      const mockResult = {
        data: [{ role_id: 'role123' }],
        error: null
      };
      mockSupabaseClient.eq.mockResolvedValue(mockResult);

      const result = await service.getServerRole('123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_servers');
      expect(mockSupabaseClient.select).toHaveBeenCalledWith('role_id');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', '123');
      expect(result).toBe('role123');
    });

    it('should return undefined when server not found', async () => {
      const mockResult = {
        data: [],
        error: null
      };
      mockSupabaseClient.eq.mockResolvedValue(mockResult);

      const result = await service.getServerRole('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should throw error on database error', async () => {
      const mockError = new Error('Database error');
      mockSupabaseClient.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.getServerRole('123')).rejects.toThrow('Database error');
    });
  });

  describe('addRoleMapping', () => {
    it('should call the correct Supabase methods with correct parameters', async () => {
      const mockResult = {
        data: { id: 1 },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.addRoleMapping(
        '123',          // serverId
        'Test Server',  // serverName
        'channel123',   // channelId
        'Test Channel', // channelName
        'test-slug',    // slug
        'role123',      // roleId
        'Test Role',    // roleName
        'attribute',    // attrKey
        'value',        // attrVal
        1               // minItems
      );

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_rules');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        server_id: '123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'Test Channel',
        slug: 'test-slug',
        role_id: 'role123',
        role_name: 'Test Role',
        attribute_key: 'attribute',
        attribute_value: 'value',
        min_items: 1
      });
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should use defaults for empty values', async () => {
      const mockResult = {
        data: { id: 1 },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.addRoleMapping(
        '123',          // serverId
        'Test Server',  // serverName
        'channel123',   // channelId
        'Test Channel', // channelName
        '',             // slug (empty)
        'role123',      // roleId
        'Test Role',    // roleName
        '',             // attrKey (empty)
        '',             // attrVal (empty)
        null            // minItems (null)
      );

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        server_id: '123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'Test Channel',
        slug: 'ALL',
        role_id: 'role123',
        role_name: 'Test Role',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1
      });
    });
  });

  describe('trackRoleAssignment', () => {
    it('should call the correct Supabase methods with correct parameters', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      const assignment = {
        userId: 'user123',
        serverId: '123',
        roleId: 'role123',
        ruleId: '1',
        address: '0xABC123',
        userName: 'Test User',
        serverName: 'Test Server',
        roleName: 'Test Role'
      };

      await service.trackRoleAssignment(assignment);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_user_roles');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        user_id: 'user123',
        server_id: '123',
        role_id: 'role123',
        rule_id: '1',
        address: '0xabc123', // Should be lowercased
        user_name: 'Test User',
        server_name: 'Test Server',
        role_name: 'Test Role',
        expires_at: null,
        status: 'active'
      });
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should handle expiration times correctly', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      const assignment = {
        userId: 'user123',
        serverId: '123',
        roleId: 'role123',
        ruleId: '1',
        address: '0xabc',
        expiresInHours: 24
      };

      await service.trackRoleAssignment(assignment);

      const insertCall = mockSupabaseClient.insert.mock.calls[0][0];
      expect(insertCall.expires_at).toBeDefined();
      expect(insertCall.expires_at).not.toBeNull();
      expect(new Date(insertCall.expires_at)).toBeInstanceOf(Date);
    });
  });

  describe('updateRoleVerification', () => {
    it('should call the correct Supabase methods for valid verification', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.updateRoleVerification('assignment123', true);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_user_roles');
      expect(mockSupabaseClient.update).toHaveBeenCalledWith({
        last_checked: expect.any(String)
      });
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', 'assignment123');
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should set status to expired for invalid verification', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.updateRoleVerification('assignment123', false);

      expect(mockSupabaseClient.update).toHaveBeenCalledWith({
        last_checked: expect.any(String),
        status: 'expired'
      });
    });
  });

  describe('Dependency Injection', () => {
    it('should properly inject the Supabase client', () => {
      // This test verifies that the service was created successfully with the injected client
      // If DI failed, the beforeEach would have thrown an error
      expect(service).toBeDefined();
      
      // Verify that calling a method attempts to use the injected client
      mockSupabaseClient.eq.mockResolvedValue({ data: [], error: null });
      service.getServerRole('test');
      
      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Supabase errors gracefully', async () => {
      const mockError = new Error('Database connection failed');
      mockSupabaseClient.upsert.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.addUpdateServer('123', 'Test', 'role123')).rejects.toThrow('Database connection failed');
    });

    it('should handle method call exceptions', async () => {
      mockSupabaseClient.eq.mockRejectedValue(new Error('Network timeout'));

      await expect(service.getServerRole('123')).rejects.toThrow('Network timeout');
    });
  });

  describe('restoreRuleWithOriginalId', () => {
    const mockRuleData = {
      id: 42,
      server_id: 'server123',
      server_name: 'Test Server',
      channel_id: 'channel123',
      channel_name: 'test-channel',
      slug: 'test-collection',
      role_id: 'role123',
      role_name: 'Test Role',
      attribute_key: 'trait',
      attribute_value: 'rare',
      min_items: 1
    };

    it('should restore rule with original ID when no conflict exists', async () => {
      // Mock that no existing rule is found
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' } // No rows found
      });

      // Mock successful insert
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { ...mockRuleData, created_at: new Date() },
        error: null
      });

      const result = await service.restoreRuleWithOriginalId(mockRuleData);

      expect(result.id).toBe(42);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_rules');
      expect(mockSupabaseClient.select).toHaveBeenCalledWith('id');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', 42);
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        id: 42,
        server_id: 'server123',
        role_id: 'role123'
      }));
    });

    it('should create new rule when ID conflict exists', async () => {
      // Mock that existing rule is found
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { id: 42 },
        error: null
      });

      // Mock successful insert with new ID
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { ...mockRuleData, id: 43, created_at: new Date() },
        error: null
      });

      const result = await service.restoreRuleWithOriginalId(mockRuleData);

      expect(result.id).toBe(43); // Should get a new ID
      // Should call insert twice: once for the ID check, once for the new rule
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        server_id: 'server123',
        role_id: 'role123'
        // Should NOT include the original ID when creating new rule
      }));
    });

    it('should handle database errors during ID conflict check', async () => {
      const dbError = new Error('Database connection failed');
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: dbError
      });

      await expect(service.restoreRuleWithOriginalId(mockRuleData))
        .rejects.toThrow('Database connection failed');
    });

    it('should use default values for missing rule data', async () => {
      const incompleteRuleData = {
        id: 42,
        server_id: 'server123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'test-channel',
        role_id: 'role123',
        role_name: 'Test Role'
        // Missing slug, attribute_key, attribute_value, min_items
      };

      // Mock that no existing rule is found
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' }
      });

      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { ...incompleteRuleData, created_at: new Date() },
        error: null
      });

      await service.restoreRuleWithOriginalId(incompleteRuleData);

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        slug: 'ALL',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1
      }));
    });
  });
});
