import { afterEach, describe, expect, it } from 'vitest';
import { APP_VERSION_INFO } from '../../../version';
import { acceptCardDataResponse, getAcceptedCardDataContract, resetCardDataContractForTests } from '../dataContract';

function response(overrides: Record<string, string> = {}): Response {
  return new Response('[]', {
    headers: {
      'X-Card-Dataset-Sha256': 'a'.repeat(64),
      'X-Card-Dataset-Release-Sha': /^[a-f0-9]{40}$/.test(APP_VERSION_INFO.buildId)
        ? APP_VERSION_INFO.buildId
        : 'b'.repeat(40),
      'X-Card-Dataset-Count': '422',
      'X-Card-Data-App-Version': APP_VERSION_INFO.appVersion,
      'X-Card-Data-Build-Id': APP_VERSION_INFO.buildId,
      'X-Card-Data-Rules-Version': APP_VERSION_INFO.rulesVersion,
      ...overrides,
    },
  });
}

describe('card data contract', () => {
  afterEach(() => resetCardDataContractForTests());

  it('accepts one release-bound dataset across card resources', () => {
    expect(acceptCardDataResponse(response())).toMatchObject({ datasetSha256: 'a'.repeat(64), cardCount: 422 });
    expect(getAcceptedCardDataContract()).toMatchObject({ datasetSha256: 'a'.repeat(64) });
    expect(acceptCardDataResponse(response())).not.toBeNull();
  });

  it('rejects rules or dataset drift within the same application runtime', () => {
    expect(acceptCardDataResponse(response())).not.toBeNull();
    expect(acceptCardDataResponse(response({ 'X-Card-Data-Rules-Version': 'stale-rules' }))).toBeNull();
    expect(acceptCardDataResponse(response({ 'X-Card-Dataset-Sha256': 'c'.repeat(64) }))).toBeNull();
  });
});
