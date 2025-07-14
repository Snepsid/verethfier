import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from '../src/services/wallet.service';
import { NonceService } from '../src/services/nonce.service';
import { DecodedData } from '../src/models/app.interface';
import { recoverTypedDataAddress } from 'viem';

// Mock viem functions
jest.mock('viem', () => ({
  recoverTypedDataAddress: jest.fn(),
}));

const mockRecoverTypedDataAddress = recoverTypedDataAddress as jest.MockedFunction<typeof recoverTypedDataAddress>;

const mockNonceService = {
  validateNonce: jest.fn(),
  isNonceUsed: jest.fn(),
  markNonceAsUsed: jest.fn(),
};

const baseData: DecodedData = {
  address: '0xabc',
  userId: 'u',
  userTag: 'tag',
  avatar: '',
  discordId: 'd',
  discordName: 'dn',
  discordIcon: '',
  nonce: 'n',
  expiry: Math.floor(Date.now() / 1000) + 1000,
};

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: NonceService, useValue: mockNonceService },
        { provide: 'UserAddressService', useValue: {} }
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    jest.clearAllMocks();
  });

  describe('verifySignature', () => {
    it('throws error when validateNonce returns false', async () => {
      mockNonceService.validateNonce.mockResolvedValue(false);
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid or expired nonce.');
    });

    it('throws error when validateNonce returns null', async () => {
      mockNonceService.validateNonce.mockResolvedValue(null);
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid or expired nonce.');
    });

    it('throws error when signature is expired', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      const expiredData = { ...baseData, expiry: Math.floor(Date.now() / 1000) - 1000 };
      await expect(service.verifySignature(expiredData, 'sig')).rejects.toThrow('Verification has expired.');
    });

    it('throws error when signature recovery fails', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockRejectedValue(new Error('Recovery failed'));
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Recovery failed');
    });

    it('throws error when recovered address does not match', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xother');
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid signature.');
    });

    it('returns address when verification succeeds', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      
      const result = await service.verifySignature(baseData, 'sig');
      
      expect(result).toBe('0xabc');
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('u', 'n');
    });

    it('uses correct EIP-712 typed data structure', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      
      await service.verifySignature(baseData, 'sig');
      
      // Verify that the unified EIP-712 structure is used (without legacy fields)
      expect(mockRecoverTypedDataAddress).toHaveBeenCalledWith({
        domain: {
          name: 'verethfier',
          version: '1',
          chainId: 1,
        },
        types: {
          Verification: [
            { name: 'UserID', type: 'string' },
            { name: 'UserTag', type: 'string' },
            { name: 'ServerID', type: 'string' },
            { name: 'ServerName', type: 'string' },
            { name: 'Nonce', type: 'string' },
            { name: 'Expiry', type: 'uint256' },
          ]
        },
        primaryType: 'Verification',
        message: {
          UserID: 'u',
          UserTag: 'tag',
          ServerID: 'd',
          ServerName: 'dn',
          Nonce: 'n',
          Expiry: baseData.expiry,
        },
        signature: 'sig',
      });
    });

    it('handles verification with minimal data', async () => {
      const minimalData: DecodedData = {
        address: '0x123',
        userId: 'user1',
        userTag: '',
        avatar: '',
        discordId: 'guild1',
        discordName: '',
        discordIcon: '',
        nonce: 'nonce1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };

      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0x123');

      const result = await service.verifySignature(minimalData, 'sig');
      
      expect(result).toBe('0x123');
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('user1', 'nonce1');
    });

    it('handles verification with complete data', async () => {
      const completeData: DecodedData = {
        address: '0x456',
        userId: 'user2',
        userTag: 'User#1234',
        avatar: 'avatar_url',
        discordId: 'guild2',
        discordName: 'Test Guild',
        discordIcon: 'icon_url',
        nonce: 'nonce2',
        expiry: Math.floor(Date.now() / 1000) + 7200,
      };

      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0x456');

      const result = await service.verifySignature(completeData, 'valid_sig');
      
      expect(result).toBe('0x456');
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('user2', 'nonce2');
      expect(mockNonceService.validateNonce).toHaveBeenCalledTimes(1);
    });

    it('validates nonce exactly once per call', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');

      await service.verifySignature(baseData, 'sig');
      
      expect(mockNonceService.validateNonce).toHaveBeenCalledTimes(1);
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('u', 'n');
    });
  });
});
