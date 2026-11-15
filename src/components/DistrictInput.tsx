import { api } from '../lib/api';
import { SuggestInput } from './Combobox';

/** District or congregation: type freely, with a live list of the ones that already exist. */
export function DistrictInput({ value, onChange, kind = 'district' }: { value: string; onChange: (v: string) => void; compact?: boolean; kind?: 'district' | 'congregation' }) {
  return (
    <SuggestInput value={value} onChange={onChange} kind={kind} placeholder={kind === 'district' ? 'Type your district' : 'Type the congregation'}
      fetcher={(q) => (kind === 'district' ? api.suggestDistricts(q) : api.suggestCongregations(q))} />
  );
}
