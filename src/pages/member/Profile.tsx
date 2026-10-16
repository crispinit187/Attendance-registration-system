import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { HeaderActions } from '../../components/Shell';
import { Alert, Loading, useToast } from '../../components/ui';
import { PersonForm, profileFromPerson, emptyProfile } from '../../components/PersonForm';

export function Profile() {
  const { account, person, refresh } = useAuth();
  const toast = useToast();
  const dist = useQuery({
    queryKey: ['my-district', person?.district_group_id],
    queryFn: async () => {
      if (!person?.district_group_id) return '';
      const { data } = await supabase.from('district_groups').select('name').eq('id', person.district_group_id).maybeSingle();
      return (data?.name as string | undefined) ?? '';
    },
  });
  if (dist.isLoading) return <div className="page"><Loading /></div>;
  const initial = person ? profileFromPerson(person, dist.data ?? '') : { ...emptyProfile, full_name: account?.full_name ?? '' };
  return (
    <div className="page stack" style={{ paddingTop: 32 }}>
      <div className="pageHead"><h1>My details</h1><HeaderActions /></div>
      <Alert kind="info">Changing your details here does not change your past attendance records. They keep the details you had at the time.</Alert>
      <div className="card">
        <PersonForm
          initial={initial}
          nameOnly={account?.role !== 'member' && !person}
          submitLabel="Save changes"
          onSubmit={async (v) => { await api.saveMyProfile(v); await refresh(); toast('Profile saved.'); }}
        />
      </div>
      <p className="muted small">Signed in as {account?.email}</p>
    </div>
  );
}
