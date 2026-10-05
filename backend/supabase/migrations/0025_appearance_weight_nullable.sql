-- Weight Cut AI — weight_kg is no longer guaranteed on every bout.
--
-- Found investigating Warrior's Cup (0012's extra promotions batch): not
-- every promotion on muaythairecords.com lists a weight on every bout the
-- way Freedom Fighter Promotions always does -- confirmed live, 10 of 14
-- real bouts on one Warriors Cup card have no weight in the compact card
-- at all. The scraper's `weight_kg is not None` guard was written when
-- weight was assumed always present, and silently dropped every one of
-- those real bouts rather than keeping the fighter/opponent data with a
-- null weight. Fighter/opponent identity is real and worth keeping even
-- when weight isn't recorded -- "who fought whom" doesn't require it.

alter table fighter_appearances alter column weight_kg drop not null;
