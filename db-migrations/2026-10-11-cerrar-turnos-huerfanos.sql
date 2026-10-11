-- Cierra los turnos que quedaron abiertos de pruebas (negocios de prueba).
-- Había 4 turnos abiertos a la vez; el activo es el de 2026-10-11, estos 3 son residuo.
-- Ejecutar a mano en el SQL Editor de Supabase.

update cash_shifts
   set status = 'closed',
       closed_at = now()
 where status = 'open'
   and id in (
     'cae3610d-f1fe-499f-880a-cf062e7ae4a9',  -- 2026-02-02
     '1b3e5913-d75b-48b7-b5f9-c89bcefb912a',  -- 2026-07-17
     'd3f409e6-96e1-45b4-ab5a-3ddddd7569c2'   -- 2026-09-08
   )
returning id, business_id, status, closed_at;

-- Comprobación: debe quedar UN solo turno abierto por negocio.
select business_id, count(*) as abiertos
  from cash_shifts
 where status = 'open'
 group by business_id
 order by abiertos desc;
