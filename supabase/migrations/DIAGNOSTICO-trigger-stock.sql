-- ============================================================================
-- DIAGNÓSTICO (solo lectura) — ¿qué está sumando stock por su cuenta?
-- ============================================================================
-- NO modifica nada. Córrelo en el SQL Editor y comparte el resultado.
--
-- SÍNTOMA MEDIDO: tras ajustar un producto a 20 en vitrina, el servidor quedó
-- en 28 (= 20 + el qty_change del movimiento). El cliente sube el stock
-- ABSOLUTO por PRODUCT_SYNC, así que algo en el servidor está sumando el
-- movimiento OTRA VEZ encima. Peor: ese valor inflado baja en el siguiente
-- pull y sobrescribe el stock correcto del dispositivo.
--
-- Hay que ver el nombre y el cuerpo de la función antes de tocar nada: la
-- tabla también tiene el trigger legítimo de `updated_at`, que NO debe caer.
-- ============================================================================

-- 1) Triggers sobre inventory_movements, con la función que ejecutan.
SELECT
  tg.tgname                                   AS trigger_name,
  p.proname                                   AS funcion,
  CASE tg.tgtype::int & 1 WHEN 1 THEN 'ROW' ELSE 'STATEMENT' END AS nivel,
  pg_get_triggerdef(tg.oid)                   AS definicion
FROM pg_trigger tg
JOIN pg_proc p ON p.oid = tg.tgfoid
WHERE tg.tgrelid = 'public.inventory_movements'::regclass
  AND NOT tg.tgisinternal
ORDER BY tg.tgname;

-- 2) Cuerpo de cada función asociada, para confirmar cuál toca products.stock.
SELECT p.proname, pg_get_functiondef(p.oid) AS cuerpo
FROM pg_trigger tg
JOIN pg_proc p ON p.oid = tg.tgfoid
WHERE tg.tgrelid = 'public.inventory_movements'::regclass
  AND NOT tg.tgisinternal
  AND p.proname <> 'set_updated_at';

-- 3) Por si el mismo patrón existe en otras tablas sincronizadas.
SELECT c.relname AS tabla, tg.tgname AS trigger_name, p.proname AS funcion
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT tg.tgisinternal
  AND p.proname <> 'set_updated_at'
ORDER BY c.relname, tg.tgname;
