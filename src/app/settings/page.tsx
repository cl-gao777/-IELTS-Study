import {SettingsWorkspace} from '@/components/settings-workspace';
import {getPreferences} from '@/server/preferences';
import {aiSettingsSummary} from '@/server/ai-settings';
import {databasePath} from '@/server/db';
export const dynamic='force-dynamic';
export default function SettingsPage(){return <SettingsWorkspace initial={getPreferences()} ai={aiSettingsSummary()} databasePath={databasePath()}/>;}
