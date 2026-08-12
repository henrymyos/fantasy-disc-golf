-- Players-tab watchlist + chat reactions:
--
--   player_watchlist  players a team has starred on the Players tab. One row
--                     per (team, player). Written by the toggleWatchlist
--                     server action (service role).
--
--   chat_reactions    emoji reactions on chat messages, Sleeper-style. One row
--                     per (message, member, emoji); toggling off deletes the
--                     row. Written by the toggleChatReaction server action.

create table if not exists public.player_watchlist (
  id serial primary key,
  league_id int not null references public.leagues(id) on delete cascade,
  team_id int not null references public.league_members(id) on delete cascade,
  player_id int not null references public.players(id) on delete cascade,
  created_at timestamptz default now(),
  unique (team_id, player_id)
);

create table if not exists public.chat_reactions (
  id serial primary key,
  league_id int not null references public.leagues(id) on delete cascade,
  message_id int not null references public.chat_messages(id) on delete cascade,
  member_id int not null references public.league_members(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz default now(),
  unique (message_id, member_id, emoji)
);

create index if not exists chat_reactions_message_idx
  on public.chat_reactions (message_id);

alter table public.player_watchlist enable row level security;
alter table public.chat_reactions enable row level security;

-- A team's watchlist is its own business.
drop policy if exists "Owners can view own watchlist" on public.player_watchlist;
create policy "Owners can view own watchlist" on public.player_watchlist
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.id = player_watchlist.team_id
        and lm.user_id = auth.uid()
    )
  );

-- Reactions are visible to everyone in the league (counts render in chat).
drop policy if exists "League members can view reactions" on public.chat_reactions;
create policy "League members can view reactions" on public.chat_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = chat_reactions.league_id
        and lm.user_id = auth.uid()
    )
  );
