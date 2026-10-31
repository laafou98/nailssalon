-- Demo salon for the hackathon: a fictional house gel line ("Maison") with
-- precomputed CIELAB (D65), and Casablanca-style prices in MAD. Re-runnable.

insert into public.salons (slug, name, city, currency, locale)
values ('demo', 'Studio Demo', 'Casablanca', 'MAD', 'fr')
on conflict (slug) do nothing;

delete from public.polishes where salon_id = (select id from public.salons where slug = 'demo');

with s as (select id from public.salons where slug = 'demo')
insert into public.polishes (salon_id, brand, name, hex, lab_l, lab_a, lab_b, finish) values
  ((select id from s), 'Maison', 'Lait d''Amande', '#F3E6DC', 92.05, 2.74, 6.44, 'cream'),
  ((select id from s), 'Maison', 'Voile Rosé', '#F2C6CF', 83.85, 16.98, 1.41, 'sheer'),
  ((select id from s), 'Maison', 'Ballerine', '#EBB8C3', 79.55, 20.03, 1.52, 'cream'),
  ((select id from s), 'Maison', 'Nude Sable', '#D8B4A0', 75.93, 9.99, 15.06, 'cream'),
  ((select id from s), 'Maison', 'Caramel', '#B98466', 59.69, 16.66, 24.27, 'cream'),
  ((select id from s), 'Maison', 'Cannelle', '#8C5A43', 43.20, 17.90, 21.73, 'cream'),
  ((select id from s), 'Maison', 'Moka', '#5A3A2E', 27.84, 12.56, 13.24, 'cream'),
  ((select id from s), 'Maison', 'Espresso', '#3B2620', 17.56, 9.00, 7.98, 'cream'),
  ((select id from s), 'Maison', 'Blanc Pur', '#F7F7F5', 97.18, -0.35, 0.96, 'cream'),
  ((select id from s), 'Maison', 'Noir Absolu', '#141414', 6.32, -0.00, 0.00, 'cream'),
  ((select id from s), 'Maison', 'Gris Perle', '#B9B7B4', 74.49, 0.15, 1.77, 'cream'),
  ((select id from s), 'Maison', 'Rose Thé', '#D99AA0', 69.76, 24.39, 6.31, 'cream'),
  ((select id from s), 'Maison', 'Framboise', '#C2305A', 44.70, 59.39, 11.19, 'cream'),
  ((select id from s), 'Maison', 'Fuchsia', '#D6247A', 48.22, 70.59, -2.98, 'cream'),
  ((select id from s), 'Maison', 'Corail', '#F0645A', 60.23, 53.28, 33.16, 'cream'),
  ((select id from s), 'Maison', 'Pêche', '#F4A585', 74.72, 25.60, 28.45, 'cream'),
  ((select id from s), 'Maison', 'Coquelicot', '#D7262E', 47.02, 65.79, 41.40, 'cream'),
  ((select id from s), 'Maison', 'Cerise', '#B0123A', 37.79, 59.91, 21.45, 'cream'),
  ((select id from s), 'Maison', 'Bordeaux', '#6E1423', 23.46, 39.32, 15.43, 'cream'),
  ((select id from s), 'Maison', 'Prune', '#4E1F3B', 19.70, 25.93, -7.42, 'cream'),
  ((select id from s), 'Maison', 'Lilas', '#C3A8D9', 72.64, 18.94, -21.14, 'cream'),
  ((select id from s), 'Maison', 'Lavande', '#9C8BC7', 61.36, 18.87, -28.75, 'cream'),
  ((select id from s), 'Maison', 'Bleu Ciel', '#A9CBEA', 80.23, -4.36, -19.02, 'cream'),
  ((select id from s), 'Maison', 'Bleu Majorelle', '#2D4FB5', 36.90, 24.30, -57.65, 'cream'),
  ((select id from s), 'Maison', 'Marine', '#1F2A55', 18.38, 10.40, -27.64, 'cream'),
  ((select id from s), 'Maison', 'Menthe', '#B4E0CB', 85.67, -18.42, 5.58, 'cream'),
  ((select id from s), 'Maison', 'Sauge', '#9CAF88', 69.12, -13.75, 17.85, 'cream'),
  ((select id from s), 'Maison', 'Olive', '#5E6B3A', 43.06, -13.63, 25.77, 'cream'),
  ((select id from s), 'Maison', 'Émeraude', '#0F6B4E', 39.86, -32.91, 9.18, 'cream'),
  ((select id from s), 'Maison', 'Citron', '#F2E27D', 89.28, -7.65, 50.98, 'cream'),
  ((select id from s), 'Maison', 'Moutarde', '#C99A2E', 66.31, 7.43, 59.65, 'cream'),
  ((select id from s), 'Maison', 'Terracotta', '#B65A3C', 48.99, 34.86, 34.22, 'cream'),
  ((select id from s), 'Maison', 'Rouge Gelée', '#A8102E', 35.78, 57.57, 26.21, 'jelly'),
  ((select id from s), 'Maison', 'Rose Gelée', '#E58FA8', 68.85, 35.75, 0.70, 'jelly'),
  ((select id from s), 'Maison', 'Miel Gelée', '#D9A35A', 70.65, 11.98, 45.15, 'jelly'),
  ((select id from s), 'Maison', 'Lait Laiteux', '#EFE3E3', 91.16, 4.07, 1.46, 'sheer'),
  ((select id from s), 'Maison', 'Nude Laiteux', '#E8C9BE', 83.26, 9.18, 9.52, 'sheer'),
  ((select id from s), 'Maison', 'Chrome Argent', '#C9CBCF', 81.64, 0.06, -2.23, 'metallic'),
  ((select id from s), 'Maison', 'Chrome Or', '#D4AF37', 72.85, 1.38, 62.91, 'metallic'),
  ((select id from s), 'Maison', 'Chrome Rose', '#E3A6A6', 73.78, 22.48, 8.89, 'metallic'),
  ((select id from s), 'Maison', 'Nacre', '#EDE3D7', 90.71, 1.37, 7.07, 'pearl'),
  ((select id from s), 'Maison', 'Paillettes Or', '#C9A75A', 70.03, 3.09, 44.01, 'shimmer_fine'),
  ((select id from s), 'Maison', 'Paillettes Argent', '#BFC3C9', 78.65, -0.24, -3.48, 'shimmer_fine'),
  ((select id from s), 'Maison', 'Galaxie', '#3A2F5A', 22.55, 16.13, -24.18, 'shimmer_coarse');

insert into public.price_rules (salon_id, base_price, art_tiers, length_surcharge, minutes)
select id, 150,
  '{"solid": 0, "french": 15, "ombre": 20, "cat_eye": 20, "art": 30, "chrome": 10}'::jsonb,
  150,
  '{"base": 45, "per_art_finger": 10, "extensions": 40}'::jsonb
from public.salons where slug = 'demo'
on conflict (salon_id) do update set
  base_price = excluded.base_price, art_tiers = excluded.art_tiers,
  length_surcharge = excluded.length_surcharge, minutes = excluded.minutes;
