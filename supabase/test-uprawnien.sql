-- Test uprawnień. Nic nie zapisuje: na końcu celowo kończy się "błędem" z wynikami, a wszystko się cofa.
do $$
declare r text := '';
begin
  insert into auth.users (id, email, aud, role) values
   ('00000000-0000-0000-0000-0000000000a1','tata@test.pl','authenticated','authenticated'),
   ('00000000-0000-0000-0000-0000000000b2','hania@test.pl','authenticated','authenticated'),
   ('00000000-0000-0000-0000-0000000000c3','obcy@test.pl','authenticated','authenticated');
  insert into families (id,name) values ('11111111-1111-1111-1111-111111111111','Test');
  insert into invites values ('tata@test.pl','11111111-1111-1111-1111-111111111111','parent','Tata'),
                             ('HANIA@test.pl','11111111-1111-1111-1111-111111111111','child','Hania');
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","email":"tata@test.pl","role":"authenticated"}',true);
  r := r || 'tata=' || (claim_invite()).role;
  insert into rewards (family_id,title,price) values ('11111111-1111-1111-1111-111111111111','Kino',200);
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2","email":"hania@test.pl","role":"authenticated"}',true);
  r := r || ' hania=' || (claim_invite()).role;
  insert into kv values (auth.uid(),'czas-nauki-v1','{}',now());
  insert into days (user_id,day,active_min) values (auth.uid(),current_date,42);
  insert into claims (reward_id,child_id,price) select id, auth.uid(), 1 from rewards;
  r := r || ' cena=' || (select price from claims limit 1);
  r := r || ' haniaInvites=' || (select count(*) from invites);
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","email":"tata@test.pl","role":"authenticated"}',true);
  r := r || ' tataDays=' || (select count(*) from days) || ' tataKv=' || (select count(*) from kv);
  update claims set status='approved';
  r := r || ' tataZatwierdzil=' || (select count(*) from claims where status='approved');
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c3","email":"obcy@test.pl","role":"authenticated"}',true);
  r := r || ' obcyDays=' || (select count(*) from days) || ' obcyKv=' || (select count(*) from kv)
         || ' obcyNagrody=' || (select count(*) from rewards) || ' obcyRodzina=' || (select count(*) from families);
  raise exception 'WYNIK: %', r;
end $$;
