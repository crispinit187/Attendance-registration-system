import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAuth, useLookups } from '../../lib/auth';
import { displayName, errMsg, fmtLongDate, fmtTime, initials } from '../../lib/format';
import { Alert, Icon, Loading, useToast } from '../../components/ui';
import { HeaderActions } from '../../components/Shell';

export function Dashboard() {
  const { account, person } = useAuth();
  const { titles, areas, voices } = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = useQuery({ queryKey: ['open-list'], queryFn: api.openList, refetchInterval: 10_000 });
  const mine = useQuery({
    queryKey: ['my-mark', open.data?.id, person?.id],
    enabled: !!open.data && !!person,
    queryFn: async () => {
      const { data } = await supabase.from('attendance').select('id,marked_at,method').eq('list_id', open.data!.id).eq('person_id', person!.id).eq('removed', false).maybeSingle();
      return data as { id: string; marked_at: string; method: string } | null;
    },
  });
  const hist = useQuery({ queryKey: ['my-history'], queryFn: api.myHistory });
  const dist = useQuery({
    queryKey: ['my-district', person?.district_group_id],
    queryFn: async () => {
      if (!person?.district_group_id) return '';
      const { data } = await supabase.from('district_groups').select('name').eq('id', person.district_group_id).maybeSingle();
      return (data?.name as string | undefined) ?? '';
    },
  });
  const title = titles.find((t) => t.id === person?.title_id)?.name;
  const shownName = person ? displayName(title, person.title_specify, person.full_name) : account?.full_name || '';
  const recent = mine.data && Date.now() - new Date(mine.data.marked_at).getTime() < 110_000 && mine.data.method === 'self';
  const details: [string, string][] = person ? [
    ['Title', title ?? ''], ['Full name', person.full_name],
    ['Area', areas.find((a) => a.id === person.area_id)?.name ?? ''], ['District', dist.data ?? ''],
    ['Voice part', voices.find((v) => v.id === person.voice_part_id)?.name ?? ''], ['Contact', person.contact || 'Not given'],
  ] : [];

  return (
    <div className="page stack" style={{ gap: 20, paddingTop: 32 }}>
      <div className="pageHead">
        <div className="who">
          <div className="avatarLg" aria-hidden="true">{initials(person?.full_name || account?.full_name || '')}</div>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 13 }}>Welcome back</div>
            <h1>{shownName}</h1>
          </div>
        </div>
        <HeaderActions />
      </div>

      {open.isLoading ? <Loading /> : open.error ? <Alert>{errMsg(open.error)}</Alert> : open.data ? (
        <div className="card live stack" style={{ gap: 14 }}>
          <div className="openTag">Open now</div>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: 1.25, fontWeight: 600 }}>{open.data.title}</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{open.data.event_name}</div>
          </div>
          {mine.data ? (
            <>
              <div className="present-ok" style={{ fontSize: 16 }}><Icon name="check" size={20} />You are marked present at {fmtTime(mine.data.marked_at)}</div>
              {recent && (
                <button className="btn danger" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { await api.undo(mine.data!.id); toast('Attendance removed.'); await qc.invalidateQueries({ queryKey: ['my-mark'] }); }
                  catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
                }}>Marked by mistake? Undo</button>
              )}
            </>
          ) : (
            <Link to="/app/scan" className="btn primary" style={{ height: 54, borderRadius: 14, fontSize: 17 }}><Icon name="scan" size={22} />Scan QR to mark attendance</Link>
          )}
          {open.data.location_check && <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>This list checks your location against the venue (within {open.data.radius_m} m). Allow location when asked.</div>}
        </div>
      ) : (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="openTag off">Not open</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20, lineHeight: 1.25, fontWeight: 600 }}>No attendance list is open right now</div>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>When an admin opens a list, it will appear here and you can scan the QR code.</div>
        </div>
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font)' }}>My details</h2>
          <Link to="/app/profile" className="btn small" style={{ color: 'var(--accent)' }}>Edit</Link>
        </div>
        {details.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>)}
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, paddingTop: 6 }}>Changing your details never changes past attendance records.</div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="row between"><h2 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font)' }}>My attendance</h2>
          {(hist.data?.length ?? 0) > 5 && <Link to="/app/history" style={{ fontSize: 14, fontWeight: 500 }}>See all</Link>}</div>
        {hist.isLoading ? <Loading /> : !hist.data?.length ? <div className="muted" style={{ fontSize: 14 }}>Nothing yet. Your attendance will show up here.</div> : hist.data.slice(0, 5).map((h) => (
          <div className="rowcard" key={h.id}>
            <div><div style={{ fontSize: 15, fontWeight: 500 }}>{h.list_title}</div><div className="muted" style={{ fontSize: 13 }}>{fmtLongDate(h.marked_at)}</div></div>
            <div className="present-ok"><Icon name="check" size={16} />Present</div>
          </div>
        ))}
      </div>
    </div>
  );
}
