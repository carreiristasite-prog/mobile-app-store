import { useUser } from '@clerk/expo';

export function useDisplayName() {
  const { user } = useUser();

  const fullName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'Estudante';

  const firstName = fullName.split(' ')[0];

  const initials = fullName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // The Arena has its own pseudonymous avatar key. This image is only the
  // private Clerk account image (for example, from an OAuth provider).
  const avatarUri = user?.imageUrl ?? null;

  return { fullName, firstName, initials, avatarUri };
}
