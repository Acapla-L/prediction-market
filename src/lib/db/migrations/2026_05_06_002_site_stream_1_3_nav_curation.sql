-- Site Stream 1+3: Hide non-sports main category tags
-- Reasoning: site is becoming sports-focused per Allan's directive
-- Reversible via the ROLLBACK section at the end of this file
-- Allan confirmed: hide all non-sports main categories (Politics, Crypto, Esports,
-- Finance, Geopolitics, Tech, Culture, World, Economy, Weather, Elections, Mentions,
-- climate & weather). Keep Trending and New (virtual tags), Sports (the existing tab).
-- New league-specific tags (MLB, NBA, NHL, UCL) deferred until after Stream 2 ships.

UPDATE tags SET is_hidden = true WHERE id IN (
  57,  -- climate & weather
  1,   -- Politics
  3,   -- Crypto
  4,   -- Esports
  5,   -- Finance
  6,   -- Geopolitics
  7,   -- Tech
  8,   -- Culture
  9,   -- World
  10,  -- Economy
  11,  -- Weather
  12,  -- Elections
  13   -- Mentions
);

-- ROLLBACK
-- Run this to restore the previous nav state:
--
-- UPDATE tags SET is_hidden = false WHERE id IN (
--   57, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
-- );
