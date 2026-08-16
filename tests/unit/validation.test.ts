import { validateLogEntry, validateBatch } from '../../src/validation/log-validator';

describe('Log Validator', () => {
  const validEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'test-service',
    message: 'test message',
    attributes: { key: 'value', num: 42, bool: true },
  };

  describe('validateLogEntry', () => {
    it('should accept a valid log entry', () => {
      const result = validateLogEntry(validEntry, 0);
      expect('valid' in result).toBe(true);
    });

    it('should reject missing timestamp', () => {
      const entry = { ...validEntry, timestamp: undefined };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
      if ('rejected' in result) {
        expect(result.rejected.reason).toContain('timestamp');
      }
    });

    it('should reject invalid timestamp', () => {
      const entry = { ...validEntry, timestamp: 'not-a-date' };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject timestamp more than 5 minutes in the future', () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const entry = { ...validEntry, timestamp: futureDate };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should accept timestamp within 5 minutes in the future', () => {
      const nearFuture = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const entry = { ...validEntry, timestamp: nearFuture };
      const result = validateLogEntry(entry, 0);
      expect('valid' in result).toBe(true);
    });

    it('should reject missing level', () => {
      const entry = { ...validEntry, level: undefined };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject invalid level', () => {
      const entry = { ...validEntry, level: 'critical' };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
      if ('rejected' in result) {
        expect(result.rejected.reason).toContain("'critical'");
      }
    });

    it('should accept all valid levels', () => {
      for (const level of ['debug', 'info', 'warn', 'error']) {
        const entry = { ...validEntry, level };
        const result = validateLogEntry(entry, 0);
        expect('valid' in result).toBe(true);
      }
    });

    it('should reject missing service', () => {
      const entry = { ...validEntry, service: undefined };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject empty service', () => {
      const entry = { ...validEntry, service: '   ' };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject missing message', () => {
      const entry = { ...validEntry, message: undefined };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject empty message', () => {
      const entry = { ...validEntry, message: '' };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should accept entry without attributes', () => {
      const entry = { ...validEntry, attributes: undefined };
      const result = validateLogEntry(entry, 0);
      expect('valid' in result).toBe(true);
      if ('valid' in result) {
        expect(result.valid.attributes).toBeNull();
      }
    });

    it('should reject attributes with nested objects', () => {
      const entry = { ...validEntry, attributes: { nested: { deep: 'value' } } };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should reject attributes with arrays', () => {
      const entry = { ...validEntry, attributes: { arr: [1, 2, 3] } };
      const result = validateLogEntry(entry, 0);
      expect('rejected' in result).toBe(true);
    });

    it('should accept attributes with string, number, and boolean values', () => {
      const entry = {
        ...validEntry,
        attributes: { str: 'hello', num: 42, bool: false },
      };
      const result = validateLogEntry(entry, 0);
      expect('valid' in result).toBe(true);
    });

    it('should include correct index in rejection', () => {
      const entry = { ...validEntry, level: 'bad' };
      const result = validateLogEntry(entry, 5);
      expect('rejected' in result).toBe(true);
      if ('rejected' in result) {
        expect(result.rejected.index).toBe(5);
      }
    });
  });

  describe('validateBatch', () => {
    it('should validate a batch and separate valid from rejected', () => {
      const entries = [
        validEntry,
        { ...validEntry, level: 'bad' },
        validEntry,
        { ...validEntry, timestamp: undefined },
      ];
      const result = validateBatch(entries);
      expect(result.valid.length).toBe(2);
      expect(result.rejected.length).toBe(2);
      expect(result.rejected[0].index).toBe(1);
      expect(result.rejected[1].index).toBe(3);
    });

    it('should return empty arrays for empty batch', () => {
      const result = validateBatch([]);
      expect(result.valid.length).toBe(0);
      expect(result.rejected.length).toBe(0);
    });
  });
});
