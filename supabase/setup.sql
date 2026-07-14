-- =========================================================
--  발주 & 광고 설정 훈련 — Supabase 초기 설정
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 한 번 실행하세요.
-- =========================================================

-- ---------- 1. 테이블 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  phone text,
  email text,
  role text default 'student',      -- 'student' | 'admin'
  status text default 'pending',    -- 'pending' | 'approved'
  created_at timestamptz default now()
);

create table if not exists public.stores (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  topic text,
  url text,
  partner_code text,
  memo text,
  created_at timestamptz default now()
);

create table if not exists public.submissions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  item text,                        -- 'shop' | 'category' | 'order' | 'amazon'
  file_path text,
  file_name text,
  status text default 'draft',      -- 'draft' | 'confirmed'
  confirmed_at timestamptz,
  review_status text default 'pending',  -- 'pending' | 'pass' | 'fail'
  review_reason text,                    -- 미통과 사유
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, item)
);

-- 주제(카테고리) — 어드민이 등록한 것만 수강생 드롭다운에 보임
create table if not exists public.topics (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean default true,      -- 끄면 수강생 세팅 드롭다운에서 사라짐
  created_at timestamptz default now()
);

-- 발주 연습에 쓰이는 상품 카탈로그 (어드민이 주제별 CSV로 등록, 수강생은 조회만)
--  * 판매가는 저장하지 않는다. 판매가 = 원가 × (1 + 설정마진/100) 으로 주문 생성 시점에 계산됨
create table if not exists public.products (
  id bigint generated always as identity primary key,
  topic text not null,              -- 주제 (주방용품 / 반려동물 ...) → 사용자가 세팅에서 고르는 단위
  name text not null,
  image_url text,                   -- 대표 사진 (목록/썸네일용)
  images jsonb default '[]'::jsonb, -- 상품 사진 전체 (상세 화면에서 넘겨보기)
  cost  numeric(10,2) not null default 0,   -- 아마존 구매 원가
  source_url text,                  -- 원본 상품 링크
  active boolean default true,      -- 끄면 주문 생성에서 제외
  created_at timestamptz default now()
);
-- (이전 버전 스키마를 이미 실행했다면 아래가 컬럼을 맞춰줌)
alter table public.products add column if not exists topic text;
alter table public.products add column if not exists images jsonb default '[]'::jsonb;
alter table public.products drop column if exists price;
alter table public.products drop column if exists category;
create index if not exists products_topic_idx on public.products (topic);

-- 이미 상품에 쓰인 주제가 있다면 topics 테이블로 옮겨둠 (한 번만 실행되면 됨)
insert into public.topics (name)
select distinct topic from public.products where topic is not null
on conflict (name) do nothing;

-- 사용자별 발주 연습 세팅 (order-setup.html 에서 저장 → order-practice.html 이 읽음)
create table if not exists public.practice_settings (
  user_id uuid primary key references auth.users on delete cascade,
  topic text,
  margin numeric(5,2) default 20,   -- 설정 마진 (%) → 판매가 = 원가 × (1 + margin/100)
  order_count int default 30,       -- 이번 연습에서 받을 총 주문 건수
  level text default '중',           -- '하' | '중' | '상' → 함정 주문 빈도
  updated_at timestamptz default now()
);

-- ---------- 2. 신규 가입 시 프로필 자동 생성 ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'phone',
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. 어드민 판별 함수 ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- 4. RLS (행 수준 보안) ----------
alter table public.profiles    enable row level security;
alter table public.stores      enable row level security;
alter table public.submissions enable row level security;
alter table public.products    enable row level security;
alter table public.topics      enable row level security;
alter table public.practice_settings enable row level security;

-- 프로필: 본인 또는 어드민만 조회, 본인만 수정
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (id = auth.uid() or public.is_admin());   -- 어드민은 승인 등 타인 프로필 수정 가능

-- 스토어: 본인 소유만 읽고/쓰고, 어드민은 조회 가능
drop policy if exists "stores_select" on public.stores;
create policy "stores_select" on public.stores for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "stores_insert" on public.stores;
create policy "stores_insert" on public.stores for insert
  with check (user_id = auth.uid());
drop policy if exists "stores_update" on public.stores;
create policy "stores_update" on public.stores for update
  using (user_id = auth.uid());
drop policy if exists "stores_delete" on public.stores;
create policy "stores_delete" on public.stores for delete
  using (user_id = auth.uid());

-- 자료 제출: 본인 소유만 쓰기, 조회는 본인/어드민
drop policy if exists "submissions_select" on public.submissions;
create policy "submissions_select" on public.submissions for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "submissions_insert" on public.submissions;
create policy "submissions_insert" on public.submissions for insert
  with check (user_id = auth.uid());
drop policy if exists "submissions_update" on public.submissions;
create policy "submissions_update" on public.submissions for update
  using (user_id = auth.uid() or public.is_admin());   -- 어드민 검수(통과/미통과) 가능
drop policy if exists "submissions_delete" on public.submissions;
create policy "submissions_delete" on public.submissions for delete
  using (user_id = auth.uid());

-- 상품: 로그인한 사람은 누구나 조회, 등록/수정/삭제는 어드민만
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select
  to authenticated using (true);
drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products for all
  using (public.is_admin()) with check (public.is_admin());

-- 주제: 로그인한 사람은 누구나 조회, 등록/삭제는 어드민만
drop policy if exists "topics_select" on public.topics;
create policy "topics_select" on public.topics for select
  to authenticated using (true);
drop policy if exists "topics_write" on public.topics;
create policy "topics_write" on public.topics for all
  using (public.is_admin()) with check (public.is_admin());

-- 연습 세팅: 본인 것만 읽고 쓰기 (어드민은 결과 확인용으로 조회 가능)
drop policy if exists "practice_settings_select" on public.practice_settings;
create policy "practice_settings_select" on public.practice_settings for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "practice_settings_write" on public.practice_settings;
create policy "practice_settings_write" on public.practice_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 5. Storage 버킷 + 정책 ----------
insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- 파일 경로 규칙: {user_id}/{item}/{filename}  → 첫 폴더가 본인 uid 여야 함
drop policy if exists "sub_files_insert" on storage.objects;
create policy "sub_files_insert" on storage.objects for insert
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "sub_files_select" on storage.objects;
create policy "sub_files_select" on storage.objects for select
  using (bucket_id = 'submissions'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "sub_files_delete" on storage.objects;
create policy "sub_files_delete" on storage.objects for delete
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================
--  실행 후 할 일:
--  1) 나를 어드민으로 지정 (이메일은 본인 것으로 교체)
--     update public.profiles set role = 'admin', status = 'approved'
--     where email = 'spharmy@adaddition.co.kr';
--  2) (테스트 편의) 이메일 인증 끄기:
--     Authentication > Providers > Email > "Confirm email" 끄기
-- =========================================================
