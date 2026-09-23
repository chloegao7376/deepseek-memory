create extension if not exists vector with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assistant_persona text not null default '',
  user_profile text not null default '',
  relationship_state text not null default '',
  response_style text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '我们的对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 50000),
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('preference', 'identity', 'relationship', 'event', 'goal', 'boundary', 'other')),
  content text not null,
  embedding_text text not null,
  embedding extensions.vector(384) not null,
  importance real not null default 0.5 check (importance between 0 and 1),
  confidence real not null default 0.8 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'superseded', 'deleted')),
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create index conversations_user_idx on public.conversations(user_id, created_at);
create index messages_conversation_idx on public.messages(conversation_id, created_at);
create index memories_user_idx on public.memories(user_id, status, created_at desc);
create index memories_embedding_hnsw on public.memories using hnsw (embedding extensions.vector_cosine_ops);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;

create policy "profiles_owner_all" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "conversations_owner_all" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages_owner_all" on public.messages
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
create policy "memories_owner_all" on public.memories
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and (
      conversation_id is null or exists (
        select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
      )
    )
  );

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.memories to authenticated;

create or replace function public.match_memories(
  query_embedding extensions.vector(384),
  p_conversation_id uuid,
  match_count integer default 8
)
returns table (
  id uuid,
  kind text,
  content text,
  importance real,
  similarity real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    m.id,
    m.kind,
    m.content,
    m.importance,
    (1 - (m.embedding <=> query_embedding))::real as similarity
  from public.memories m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (m.conversation_id is null or m.conversation_id = p_conversation_id)
  order by ((1 - (m.embedding <=> query_embedding)) + m.importance * 0.08) desc
  limit least(greatest(match_count, 1), 20);
$$;

grant execute on function public.match_memories(extensions.vector, uuid, integer) to authenticated;
