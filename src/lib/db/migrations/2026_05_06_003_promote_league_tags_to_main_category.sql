-- Promote 5 league tags to main category (for home-v2 nav tabs)
-- Reasoning: Allan's home-v2 cutover requires NBA/MLB/NHL/NFL/UCL as main-nav tabs.
-- Each tab links to a home-v2 anchor section (per Path Z; URLs flip to
-- /sports/{league}/games when Stream 2 ships).
-- Uses slug lookups for robustness (idempotent on already-promoted tags).
-- Sports tag (slug='sports', id=2) stays at display_order=2; new tabs at 14-18.
-- Order reflects current data activity (MLB has 50 games, NBA 14, NHL 9,
-- NFL/UCL futures only).

-- Update existing tags (slug-based for robustness):
UPDATE tags SET is_main_category = true, is_hidden = false, display_order = 14 WHERE slug = 'mlb';
UPDATE tags SET is_main_category = true, is_hidden = false, display_order = 15 WHERE slug = 'nba';
UPDATE tags SET is_main_category = true, is_hidden = false, display_order = 16 WHERE slug = 'nhl';
UPDATE tags SET is_main_category = true, is_hidden = false, display_order = 17 WHERE slug = 'nfl';
UPDATE tags SET is_main_category = true, is_hidden = false, display_order = 18 WHERE slug = 'ucl';

-- Insert tags that don't exist yet (idempotent fallback for fresh DBs / future):
INSERT INTO tags (slug, name, is_main_category, is_hidden, display_order)
SELECT 'mlb', 'MLB', true, false, 14 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'mlb');
INSERT INTO tags (slug, name, is_main_category, is_hidden, display_order)
SELECT 'nba', 'NBA', true, false, 15 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'nba');
INSERT INTO tags (slug, name, is_main_category, is_hidden, display_order)
SELECT 'nhl', 'NHL', true, false, 16 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'nhl');
INSERT INTO tags (slug, name, is_main_category, is_hidden, display_order)
SELECT 'nfl', 'NFL', true, false, 17 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'nfl');
INSERT INTO tags (slug, name, is_main_category, is_hidden, display_order)
SELECT 'ucl', 'UCL', true, false, 18 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'ucl');

-- ROLLBACK
-- Run this to restore the previous nav state:
--
-- UPDATE tags SET is_main_category = false, display_order = 0
--   WHERE slug IN ('mlb', 'nba', 'nhl', 'nfl', 'ucl');
