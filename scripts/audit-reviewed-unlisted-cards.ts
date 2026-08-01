import { loadReviewedUnlistedRelease } from './reviewedUnlistedCardRelease';

const release = loadReviewedUnlistedRelease(
  process.env.CARD_UNLISTED_SOURCES_SOURCE || 'data/card-unlisted-sources.json',
  process.env.CARD_UNLISTED_HUMAN_REVIEWS_SOURCE || 'data/card-unlisted-human-reviews.json',
  process.env.CARD_UNLISTED_RELEASE_SOURCE || 'data/card-unlisted-release.json',
);

console.log(
  `Reviewed unlisted-card release audit passed: ${release.cards.map((card) => card.id).join(', ')} ` +
    `(${release.sourceSha256}).`,
);
