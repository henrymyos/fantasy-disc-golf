import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MemberManager } from "@/components/member-manager";

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, commissioner_id, max_teams")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!myMember) redirect(`/league/${id}`);

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, user_id, draft_position, joined_at")
    .eq("league_id", id)
    .order("joined_at", { ascending: true });

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", id)
    .maybeSingle();
  const draftLocked = ["in_progress", "paused", "complete"].includes((draft as any)?.status);

  const commissionerUserId = (league as any).commissioner_id as string;
  const isCommissioner = commissionerUserId === user.id;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Members</h2>
        <p className="text-gray-400 text-sm mt-1">
          {(members ?? []).length} of {(league as any).max_teams} teams
          {draftLocked
            ? " · removing teams is locked once the draft starts"
            : isCommissioner
            ? " · remove teams or hand off the commissioner role"
            : ""}
        </p>
      </div>

      <MemberManager
        leagueId={Number(id)}
        myMemberId={myMember.id}
        isCommissioner={isCommissioner}
        draftLocked={draftLocked}
        members={(members ?? []).map((m: any) => ({
          id: m.id,
          teamName: m.team_name,
          isCommissioner: m.user_id === commissionerUserId,
          isMe: m.user_id === user.id,
        }))}
      />
    </div>
  );
}
