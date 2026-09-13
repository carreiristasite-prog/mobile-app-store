import { useAuth } from '@clerk/expo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/src/services/api/ApiProvider';
import type {
  AgeBand,
  GuardianInvitationDto,
  GuardianLinkDto,
  GuardianLinksDto,
  GuardianRevocationDto,
  OnboardingStateDto,
  PlatformAgeSignalReport,
} from '@/src/services/api/dtos';
import { apiPaths } from '@/src/services/api/paths';
import { ApiError } from '@/src/services/api/types';

export const onboardingQueryKey = (userId: string | null | undefined) => ['identity', 'onboarding', userId ?? 'signed-out'] as const;

export function useOnboardingState() {
  const { userId, isSignedIn } = useAuth();
  const { client } = useApi();
  return useQuery({
    queryKey: onboardingQueryKey(userId),
    queryFn: () => client.request<OnboardingStateDto>(apiPaths.onboardingState),
    enabled: Boolean(isSignedIn && userId && client.configured),
    retry: 1,
    staleTime: 15_000,
  });
}

function useStateMutation<TInput>(mutationFn: (input: TInput) => Promise<OnboardingStateDto>) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (state) => {
      queryClient.setQueryData(onboardingQueryKey(userId), state);
    },
    onError: async (error) => {
      if (isPolicySnapshotStale(error)) {
        await queryClient.refetchQueries({ queryKey: onboardingQueryKey(userId), type: 'active' });
      }
    },
  });
}

function isPolicySnapshotStale(error: unknown): boolean {
  return error instanceof ApiError
    && error.problem.status === 412
    && error.problem.type === 'https://api.iaaprova.com.br/problems/policy-version-stale';
}

export type IdentityPolicySnapshotInput = {
  policyVersion: string;
  termsVersion: string;
  privacyNoticeVersion: string;
};

export function useSetAgeProfile() {
  const { client } = useApi();
  return useStateMutation((ageBand: AgeBand) => client
    .mutate<OnboardingStateDto>(apiPaths.ageProfile, {
      method: 'PUT',
      body: { ageBand },
      queueWhenOffline: false,
    })
    .then((result) => {
      if (result.state !== 'completed') throw new Error('A faixa etária não foi confirmada pelo servidor.');
      return result.data;
    }));
}

export function useReportPlatformAgeSignal() {
  const { client } = useApi();
  return useStateMutation((input: PlatformAgeSignalReport) => client
    .mutate<OnboardingStateDto>(apiPaths.platformAgeSignal, {
      method: 'POST',
      body: input,
      queueWhenOffline: false,
    })
    .then((result) => {
      if (result.state !== 'completed') throw new Error('O sinal etário da loja não foi confirmado pelo servidor.');
      return result.data;
    }));
}

export function useRecordLegalAcknowledgement() {
  const { client } = useApi();
  return useStateMutation((input: IdentityPolicySnapshotInput & {
    kind: 'terms_acceptance' | 'privacy_notice_acknowledgement';
  }) => client
    .mutate<OnboardingStateDto>(apiPaths.legalAcknowledgements, {
      method: 'POST',
      body: { ...input, acknowledged: true },
      queueWhenOffline: false,
    })
    .then((result) => {
      if (result.state !== 'completed') throw new Error('O documento não foi confirmado pelo servidor.');
      return result.data;
    }));
}

export function useRecordOptionalConsent() {
  const { client } = useApi();
  return useStateMutation((input: { kind: 'social' | 'notifications'; granted: boolean }) => client
    .mutate<OnboardingStateDto>(apiPaths.optionalConsents, {
      method: 'POST',
      body: input,
      queueWhenOffline: false,
    })
    .then((result) => {
      if (result.state !== 'completed') throw new Error('A preferência não foi confirmada pelo servidor.');
      return result.data;
    }));
}

export function useCreateGuardianInvitation() {
  const { client } = useApi();
  return useMutation({
    mutationFn: async () => {
      const result = await client.mutate<GuardianInvitationDto>(apiPaths.guardianInvitations, {
        method: 'POST',
        queueWhenOffline: false,
      });
      if (result.state !== 'completed') throw new Error('O convite não foi confirmado pelo servidor.');
      return result.data;
    },
  });
}

export type AcceptGuardianInvitationInput = {
  token: string;
  acknowledgements: {
    responsibility: true;
    termsAccepted: true;
    privacyNoticeAcknowledged: true;
  };
  permissions: { social: boolean; notifications: boolean };
} & IdentityPolicySnapshotInput;

export function useAcceptGuardianInvitation() {
  const { client } = useApi();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AcceptGuardianInvitationInput) => {
      const result = await client.mutate<GuardianLinkDto>(apiPaths.guardianInvitationAccept, {
        method: 'POST',
        body: input,
        queueWhenOffline: false,
      });
      if (result.state !== 'completed') throw new Error('O aceite não foi confirmado pelo servidor.');
      return result.data;
    },
    onError: async (error) => {
      if (isPolicySnapshotStale(error)) {
        await queryClient.refetchQueries({ queryKey: onboardingQueryKey(userId), type: 'active' });
      }
    },
  });
}

export const guardianLinksQueryKey = (userId: string | null | undefined) => ['identity', 'guardian-links', userId ?? 'signed-out'] as const;

export function useGuardianLinks() {
  const { userId, isSignedIn } = useAuth();
  const { client } = useApi();
  return useQuery({
    queryKey: guardianLinksQueryKey(userId),
    queryFn: () => client.request<GuardianLinksDto>(apiPaths.guardianLinks),
    enabled: Boolean(isSignedIn && userId && client.configured),
    retry: 1,
    staleTime: 15_000,
  });
}

export function useRevokeGuardianLink() {
  const { client } = useApi();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const result = await client.mutate<GuardianRevocationDto>(apiPaths.guardianLink(linkId), {
        method: 'DELETE',
        queueWhenOffline: false,
      });
      if (result.state !== 'completed') throw new Error('A revogação não foi confirmada pelo servidor.');
      return result.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: onboardingQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: guardianLinksQueryKey(userId) }),
      ]);
    },
  });
}
