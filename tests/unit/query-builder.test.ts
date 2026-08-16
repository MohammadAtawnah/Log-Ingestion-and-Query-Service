import { parseQueryParams, decodeCursor, ValidationError } from '../../src/services/query.service';
import { parseAggregateParams } from '../../src/services/aggregate.service';

describe('Query Parameter Parsing', () => {
  describe('parseQueryParams', () => {
    it('should return defaults when no params provided', () => {
      const result = parseQueryParams({});
      expect(result.limit).toBe(100);
      expect(result.service).toBeUndefined();
      expect(result.level).toBeUndefined();
    });

    it('should parse service filter', () => {
      const result = parseQueryParams({ service: 'checkout' });
      expect(result.service).toBe('checkout');
    });

    it('should parse level filter', () => {
      const result = parseQueryParams({ level: 'error' });
      expect(result.level).toBe('error');
    });

    it('should reject invalid level', () => {
      expect(() => parseQueryParams({ level: 'critical' })).toThrow(ValidationError);
    });

    it('should parse since and until', () => {
      const result = parseQueryParams({
        since: '2026-07-20T14:00:00Z',
        until: '2026-07-20T15:00:00Z',
      });
      expect(result.since).toBeInstanceOf(Date);
      expect(result.until).toBeInstanceOf(Date);
    });

    it('should reject until before since', () => {
      expect(() =>
        parseQueryParams({
          since: '2026-07-20T15:00:00Z',
          until: '2026-07-20T14:00:00Z',
        })
      ).toThrow(ValidationError);
    });

    it('should parse limit', () => {
      const result = parseQueryParams({ limit: '500' });
      expect(result.limit).toBe(500);
    });

    it('should reject non-numeric limit', () => {
      expect(() => parseQueryParams({ limit: 'abc' })).toThrow(ValidationError);
    });

    it('should reject limit out of range', () => {
      expect(() => parseQueryParams({ limit: '0' })).toThrow(ValidationError);
      expect(() => parseQueryParams({ limit: '1001' })).toThrow(ValidationError);
    });

    it('should parse q parameter', () => {
      const result = parseQueryParams({ q: 'declined' });
      expect(result.q).toBe('declined');
    });

    it('should parse attribute filters', () => {
      const result = parseQueryParams({ 'attr.user_id': '42', 'attr.region': 'eu' });
      expect(result.attributes).toEqual({ user_id: '42', region: 'eu' });
    });

    it('should reject invalid timestamps', () => {
      expect(() => parseQueryParams({ since: 'not-a-date' })).toThrow(ValidationError);
      expect(() => parseQueryParams({ until: 'bad' })).toThrow(ValidationError);
    });
  });

  describe('decodeCursor', () => {
    it('should decode a valid cursor', () => {
      const data = { timestamp: '2026-07-20T14:00:00.000Z', id: '123' };
      const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
      const result = decodeCursor(encoded);
      expect(result.timestamp).toBe('2026-07-20T14:00:00.000Z');
      expect(result.id).toBe('123');
    });

    it('should reject malformed cursors', () => {
      expect(() => decodeCursor('not-base64!!!')).toThrow(ValidationError);
      expect(() => decodeCursor(Buffer.from('{}').toString('base64'))).toThrow(ValidationError);
      expect(() => decodeCursor(Buffer.from('{"timestamp":"bad"}').toString('base64'))).toThrow(ValidationError);
    });
  });

  describe('parseAggregateParams', () => {
    const validParams = {
      since: '2026-07-20T14:00:00Z',
      until: '2026-07-20T15:00:00Z',
      bucket: '1m',
    };

    it('should parse valid aggregate params', () => {
      const result = parseAggregateParams(validParams);
      expect(result.since).toBeInstanceOf(Date);
      expect(result.until).toBeInstanceOf(Date);
      expect(result.bucket).toBe('1m');
    });

    it('should require since', () => {
      expect(() => parseAggregateParams({ ...validParams, since: undefined })).toThrow(ValidationError);
    });

    it('should require until', () => {
      expect(() => parseAggregateParams({ ...validParams, until: undefined })).toThrow(ValidationError);
    });

    it('should require bucket', () => {
      expect(() => parseAggregateParams({ ...validParams, bucket: undefined })).toThrow(ValidationError);
    });

    it('should reject invalid bucket', () => {
      expect(() => parseAggregateParams({ ...validParams, bucket: '2m' })).toThrow(ValidationError);
    });

    it('should accept all valid bucket sizes', () => {
      for (const bucket of ['1m', '5m', '1h', '1d']) {
        const result = parseAggregateParams({ ...validParams, bucket });
        expect(result.bucket).toBe(bucket);
      }
    });

    it('should parse group_by', () => {
      const result = parseAggregateParams({ ...validParams, group_by: 'service' });
      expect(result.groupBy).toBe('service');
    });

    it('should reject invalid group_by', () => {
      expect(() => parseAggregateParams({ ...validParams, group_by: 'timestamp' })).toThrow(ValidationError);
    });
  });
});
