begin;
select plan(9);
select policies_are('public', 'profiles', array['Command users can read their own profile', 'Command users can update their own display name']::name[]);
select policies_are('public', 'command_roles', array['No direct command role access']::name[]);
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has row-level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.command_roles'::regclass), 'command_roles has row-level security enabled');
select table_privs_are('public', 'profiles', 'anon', array[]::name[]);
select table_privs_are('public', 'command_roles', 'anon', array[]::name[]);
select table_privs_are('public', 'command_roles', 'authenticated', array[]::name[]);
select ok(
  not has_function_privilege('public', 'public.handle_new_command_user()', 'EXECUTE'),
  'public has no execute privilege on handle_new_command_user'
);
select has_index('public'::name, 'command_roles'::name, 'command_roles_assigned_by_idx'::name);
select * from finish();
rollback;
