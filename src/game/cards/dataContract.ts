import { APP_VERSION_INFO } from '../../version';

export interface CardDataContract {
  datasetSha256: string;
  releaseSha: string;
  cardCount: number;
  appVersion: string;
  buildId: string;
  rulesVersion: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/;
let acceptedContract: CardDataContract | null = null;

function header(response: Response, name: string): string {
  return response.headers.get(name)?.trim() ?? '';
}

export function parseCardDataContract(response: Response): CardDataContract | null {
  const datasetSha256 = header(response, 'X-Card-Dataset-Sha256');
  const releaseSha = header(response, 'X-Card-Dataset-Release-Sha');
  const cardCount = Number(header(response, 'X-Card-Dataset-Count'));
  const appVersion = header(response, 'X-Card-Data-App-Version');
  const buildId = header(response, 'X-Card-Data-Build-Id');
  const rulesVersion = header(response, 'X-Card-Data-Rules-Version');
  if (
    !SHA256_PATTERN.test(datasetSha256) ||
    !RELEASE_SHA_PATTERN.test(releaseSha) ||
    !Number.isSafeInteger(cardCount) ||
    cardCount <= 0 ||
    !appVersion ||
    !buildId ||
    !rulesVersion
  ) {
    return null;
  }
  return { datasetSha256, releaseSha, cardCount, appVersion, buildId, rulesVersion };
}

export function acceptCardDataResponse(response: Response): CardDataContract | null {
  const contract = parseCardDataContract(response);
  if (!contract) {
    const production = Boolean((import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD);
    return production
      ? null
      : {
          datasetSha256: '0'.repeat(64),
          releaseSha: '0'.repeat(40),
          cardCount: 1,
          ...APP_VERSION_INFO,
        };
  }
  if (
    contract.appVersion !== APP_VERSION_INFO.appVersion ||
    contract.buildId !== APP_VERSION_INFO.buildId ||
    contract.rulesVersion !== APP_VERSION_INFO.rulesVersion
  ) {
    return null;
  }
  if (RELEASE_SHA_PATTERN.test(APP_VERSION_INFO.buildId) && contract.releaseSha !== APP_VERSION_INFO.buildId) {
    return null;
  }
  if (
    acceptedContract &&
    (acceptedContract.datasetSha256 !== contract.datasetSha256 ||
      acceptedContract.releaseSha !== contract.releaseSha ||
      acceptedContract.cardCount !== contract.cardCount)
  ) {
    return null;
  }
  acceptedContract = contract;
  return contract;
}

export function getAcceptedCardDataContract(): CardDataContract | null {
  return acceptedContract;
}

export function resetCardDataContractForTests(): void {
  acceptedContract = null;
}
