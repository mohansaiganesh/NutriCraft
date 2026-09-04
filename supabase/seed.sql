-- NutriCraft shared food catalog seed. Run after schema.sql + rls.sql.
-- Shared rows: user_id = NULL, is_custom = false. Ids match lib/seed.ts seedFoodId()
-- ('seed-<name>') so a local seed and this cloud row dedupe by primary key.

insert into public.food_items
  (id, user_id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, price_per_100, is_custom, deleted)
values
  ('seed-almonds_kirkland_signature', null, 'almonds_kirkland_signature', 'Generic', 100, 566.6666666666667, 20, 30, 40, 30, 0, 1.037037037037037, false, false),
  ('seed-blueberries_dried_sweetened_kirkland', null, 'blueberries_dried_sweetened_kirkland', 'Generic', 100, 350, 0, 82.5, 1.25, 7.5, 0, 2.6785714285714284, false, false),
  ('seed-blueberries_wild_kirkland_signature', null, 'blueberries_wild_kirkland_signature', 'Generic', 100, 57.14285714285714, 0, 13.571428571428571, 0, 4.285714285714286, 0, 0.625, false, false),
  ('seed-butter_salted_members_mark', null, 'butter_salted_members_mark', 'Generic', 100, 714.2857142857143, 0, 0, 78.57142857142857, 0, 0, 0.47098214285714285, false, false),
  ('seed-cashews_roasted_salted_members_mark', null, 'cashews_roasted_salted_members_mark', 'Generic', 100, 607.1428571428571, 17.857142857142858, 32.142857142857146, 46.42857142857143, 3.571428571428571, 0, 1.5151515151515151, false, false),
  ('seed-chicken_breast_boneless_skinless_members_mark', null, 'chicken_breast_boneless_skinless_members_mark', 'Generic', 100, 107.14285714285714, 20.535714285714285, 0, 2.232142857142857, 0, 0, 0.6696428571428571, false, false),
  ('seed-cranberry_ocean_spray', null, 'cranberry_ocean_spray', 'Generic', 100, 325, 0, 82.5, 0, 7.5, 0, 0.5602941176470588, false, false),
  ('seed-dates_medjool', null, 'dates_medjool', 'Generic', 100, 311.11111111111114, 2.2222222222222223, 73.33333333333333, 0, 8.88888888888889, 0, 1.046783625730994, false, false),
  ('seed-dates_organic_pitted_hadley', null, 'dates_organic_pitted_hadley', 'Generic', 100, 275, 2.5, 75, 0, 7.5, 0, 0.8928571428571428, false, false),
  ('seed-eggs_members_mark', null, 'eggs_members_mark', 'Generic', 100, 140, 12, 0, 10, 0, 0, 0.33333333333333337, false, false),
  ('seed-fish_tilapia_fillets_boneless_skinless_members_mark', null, 'fish_tilapia_fillets_boneless_skinless_members_mark', 'Generic', 100, 79.64601769911505, 15.929203539823009, 0, 1.3274336283185841, 0, 0, 1.0796460176991152, false, false),
  ('seed-ghee_deep', null, 'ghee_deep', 'Generic', 100, 800, 0, 0, 90, 0, 0, 1.746031746031746, false, false),
  ('seed-honey_nates', null, 'honey_nates', 'Generic', 100, 333.33333333333337, 0, 80.95238095238095, 0, 0, 0, 1.1799838579499595, false, false),
  ('seed-milk_whole_heb', null, 'milk_whole_heb', 'Generic', 100, 63.559322033898304, 3.389830508474576, 5.084745762711865, 3.389830508474576, 0, 0, 0.08792372881355931, false, false),
  ('seed-peanuts_members_mark', null, 'peanuts_members_mark', 'Generic', 100, 642.8571428571429, 25, 17.857142857142858, 53.57142857142857, 7.142857142857142, 0, 0.6302521008403361, false, false),
  ('seed-pistachios_members_mark', null, 'pistachios_members_mark', 'Generic', 100, 566.6666666666667, 20, 30, 43.333333333333336, 10, 0, 2.301449275362319, false, false),
  ('seed-potato_chips_heb_buffalo_flavored', null, 'potato_chips_heb_buffalo_flavored', 'Generic', 100, 535.7142857142857, 7.142857142857142, 53.57142857142857, 32.142857142857146, 3.571428571428571, 0, 0.5912698412698413, false, false),
  ('seed-pumpkin_seeds_hulled_anna_sarah', null, 'pumpkin_seeds_hulled_anna_sarah', 'Generic', 100, 559, 30, 11, 49, 6, 0, 1.3656387665198237, false, false),
  ('seed-rice_basmati_royal', null, 'rice_basmati_royal', 'Generic', 100, 355.55555555555554, 8.88888888888889, 80, 0, 2.2222222222222223, 0, 0.24322830292979547, false, false),
  ('seed-simply_granola_oats_quaker', null, 'simply_granola_oats_quaker', 'Generic', 100, 397.05882352941177, 10.294117647058822, 75, 10.294117647058822, 10.294117647058822, 0, 0.5010141987829615, false, false),
  ('seed-sunflower_seeds_anna_sarah', null, 'sunflower_seeds_anna_sarah', 'Generic', 100, 571.4285714285714, 21.428571428571427, 17.857142857142858, 50, 10.714285714285714, 0, 0.8928571428571428, false, false),
  ('seed-toor_dal_royal_split_pigeon_heb', null, 'toor_dal_royal_split_pigeon_heb', 'Generic', 100, 320, 20, 60, 2, 14.000000000000002, 0, 0.38333333333333336, false, false),
  ('seed-walnuts_members_mark', null, 'walnuts_members_mark', 'Generic', 100, 642.8571428571429, 14.285714285714285, 14.285714285714285, 64.28571428571429, 7.142857142857142, 0, 0.9672619047619048, false, false),
  ('seed-whey_protein_on', null, 'whey_protein_on', 'Generic', 100, 375, 75, 9.375, 6.25, 1.5625, 0, 2.734375, false, false)
on conflict (id) do nothing;
