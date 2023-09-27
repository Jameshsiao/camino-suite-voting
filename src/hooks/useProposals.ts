import { useQuery, useMutation } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { filter, find, orderBy } from 'lodash';
import { BinTools, platformvm } from '@c4tplatform/caminojs/dist';
import { Serialization } from '@c4tplatform/caminojs/dist/utils/serialization';
import { KeyPair } from '@c4tplatform/caminojs/dist/apis/platformvm';
import {
  fetchProposalDetail,
  fetchCompletedVotes,
  fetchActiveVotings,
} from '@/apis/proposals';
import {
  APIPRoposalWrapper,
  APIProposal,
  APIVote,
  Proposal,
  ProposalStatuses,
  ProposalTypes,
  VotingOption,
} from '@/types';
import useWallet from './useWallet';
import useToast from './useToast';
import useNetwork from './useNetwork';
import { useMultisig } from './useMultisig';

const serialization = Serialization.getInstance();
const parseAPIProposal = (proposal?: APIProposal) => {
  if (proposal) {
    const optionsBuf = serialization.typeToBuffer(proposal.options, 'base64');
    const options = JSON.parse(optionsBuf.toString());
    let outcome;
    if (proposal.outcome) {
      const outcomeBuf = serialization.typeToBuffer(proposal.outcome, 'base64');
      outcome = JSON.parse(outcomeBuf.toString());
    }
    const proposalType = Object.values(ProposalTypes)[proposal.type];
    const now = DateTime.now();
    const startTime = DateTime.fromISO(proposal.startTime);
    const endTime = DateTime.fromISO(proposal.endTime);
    const inactive = startTime > now;
    const isCompleted =
      (Object.values(ProposalStatuses).indexOf(ProposalStatuses.Completed) &
        (proposal.status ?? 0)) >
      0;
    return {
      ...proposal,
      outcome,
      typeId: proposal.type,
      type: proposalType,
      options: options.map((opt: number, idx: number) => ({
        option: idx,
        value: opt,
      })),
      startTimestamp: startTime.toUnixInteger(),
      endTimestamp: endTime.toUnixInteger(),
      inactive,
      isCompleted,
      description: serialization
        .typeToBuffer(proposal.memo, 'base64')
        .toString(),
    };
  }
  return;
};
const parseAPIProposals = (
  hrp: string,
  proposals?: APIPRoposalWrapper[],
  currentWalletAddress?: string
) => {
  if (!proposals) return [];
  return proposals.map(proposalWrapper => {
    const proposal = parseAPIProposal(proposalWrapper.dacProposal);
    const votes = proposalWrapper.dacVotes.map(vote => parseAPIVote(vote, hrp));
    let voted;
    if (currentWalletAddress) {
      voted = find(votes, { voterAddr: currentWalletAddress });
      voted = voted?.votedOptions.map((v: number) => ({ option: v }));
    }

    return {
      ...proposal,
      votes,
      voted,
    };
  });
};
const parseAPIVote = (vote: APIVote, hrp: string) => {
  const votedOptionsBuf = serialization.typeToBuffer(
    vote.votedOptions,
    'base64'
  );
  const votedOptions = JSON.parse(votedOptionsBuf.toString());
  const votedDateTime = DateTime.fromISO(vote.votedAt).toUnixInteger();
  return {
    ...vote,
    votedDateTime,
    votedOptions,
  };
};

export const useActiveVotings = (currentWalletAddress?: string, page = 0) => {
  const { activeNetwork } = useNetwork();
  const { data, isInitialLoading, isFetching, refetch, error } = useQuery(
    ['getActiveVotings', page],
    async () => fetchActiveVotings(page),
    { notifyOnChangeProps: ['data', 'error'] }
  );

  console.debug(
    'useActiveVotings isInitialLoading: ',
    isInitialLoading,
    isFetching
  );
  const proposals = parseAPIProposals(
    activeNetwork?.name ?? 'local',
    data?.data.dacProposals,
    currentWalletAddress
  );

  return {
    isFetching,
    isInitialLoading,
    error,
    refetch,
    proposals: proposals ?? [],
  };
};

export const useUpcomingVotings = (page = 0) => {
  const { proposals, isFetching, error, refetch } = useActiveVotings(
    undefined,
    page
  );
  const upcomings = filter(proposals, proposal => proposal.inactive);
  return {
    proposals: upcomings,
    isFetching,
    error,
    refetch,
  };
};

export const useCompletedVotes = (
  type: number,
  startTime?: string,
  endTime?: string,
  page = 0
) => {
  const { activeNetwork } = useNetwork();
  const { data, isFetching, error, refetch } = useQuery(
    ['getCompletedVotes', type, startTime, endTime, page],
    async () => fetchCompletedVotes(type, startTime, endTime),
    {
      refetchOnWindowFocus: false,
      notifyOnChangeProps: ['data', 'error'],
    }
  );
  const proposals = parseAPIProposals(
    activeNetwork?.name ?? 'local',
    data?.data.dacProposals
  );
  const sortedProposals = orderBy(proposals, ['startTimestamp'], ['desc']);

  return {
    proposals: sortedProposals.map((p, idx) => ({
      ...p,
      seq: sortedProposals.length - idx,
    })),
    error,
    isFetching,
    refetch,
  };
};

export const useProposal = (id: string, signer?: KeyPair) => {
  const { activeNetwork } = useNetwork();
  const { data, isLoading, error, refetch } = useQuery(
    ['getProposalDetail', id],
    async () => fetchProposalDetail(id),
    {
      notifyOnChangeProps: ['data', 'error'],
    }
  );

  const proposal = parseAPIProposal(data?.data.dacProposal);
  const votes = data?.data.dacVotes.map((vote: APIVote) =>
    parseAPIVote(vote, activeNetwork!.name)
  );

  // Find voted by current wallet
  let voted;
  if (signer) {
    voted = find(votes, { voterAddr: signer.getAddressString() });
  }

  return {
    proposal: {
      ...(proposal ?? {}),
      voted: voted?.votedOptions.map((v: number) => ({ option: v })),
      votes,
    },
    error,
    isLoading,
    refetch,
  };
};

export const useAddProposal = (
  proposalType: number | string,
  option?: { onSuccess?: (data: any) => void; onSettled?: (data: any) => void }
) => {
  const toast = useToast();
  const { pchainAPI, signer, multisigWallet } = useWallet();
  const { tryToCreateMultisig } = useMultisig();
  const mutation = useMutation({
    mutationFn: async ({
      startDate,
      endDate,
      votingOptions,
      description,
    }: {
      startDate: DateTime;
      endDate: DateTime;
      votingOptions: VotingOption[];
      description: string;
    }) => {
      let proposal: platformvm.Proposal;
      switch (proposalType) {
        case 0:
        case 'BASE_FEE':
          proposal = new platformvm.BaseFeeProposal(
            startDate.startOf('day').toUnixInteger(),
            endDate.endOf('day').toUnixInteger()
          );
          votingOptions
            .map((opt: VotingOption) => opt.value)
            .forEach(opt => proposal.addBaseFeeOption(opt));
          break;
        default:
          throw `Unsupported proposal type: ${proposalType}`;
      }

      // return if cannot access RPC
      if (!pchainAPI) return;

      // Non-multisig wallet connected
      if (!multisigWallet && signer) {
        const txs = await pchainAPI.getUTXOs(
          pchainAPI.keyChain().getAddressStrings()
        );
        const unsignedTx = await pchainAPI.buildAddProposalTx(
          txs.utxos,
          pchainAPI.keyChain().getAddressStrings(),
          pchainAPI.keyChain().getAddressStrings(),
          proposal,
          signer.getAddress(),
          0,
          serialization.typeToBuffer(description, 'utf8')
        );
        const tx = unsignedTx.sign(pchainAPI.keyChain());
        const txid: string = await pchainAPI.issueTx(tx);
        return txid;
      }

      // Multisig Wallet connected
      if (multisigWallet) {
        const multisigAlias = BinTools.getInstance().addressToString(
          multisigWallet.hrp,
          multisigWallet.pchainId,
          multisigWallet.keyData.alias
        );
        const txs = await pchainAPI?.getUTXOs([multisigAlias]);
        const unsignedTx = await pchainAPI.buildAddProposalTx(
          txs.utxos,
          [multisigAlias, ...multisigWallet.keyData.owner.addresses],
          [multisigAlias],
          proposal,
          multisigWallet.keyData.alias,
          0,
          serialization.typeToBuffer(description, 'utf8'),
          undefined,
          multisigWallet.keyData.owner.threshold
        );
        // - check signavault to get pending Txs
        tryToCreateMultisig && (await tryToCreateMultisig(unsignedTx));
      }
    },
    onSuccess: data => {
      option?.onSuccess
        ? option.onSuccess(data)
        : toast.success(`AddProposalTx sent with TxID: ${data}`);
    },
    onError: error => toast.error(`Failed to add proposal: ${error}`),
    onSettled: option && option.onSettled,
  });

  return mutation.mutate;
};

export const useEligibleCMembers = (proposal: Proposal) => {
  const { caminoClient } = useNetwork();
  const { data, error } = useQuery({
    queryKey: ['getEligibleCMembers', proposal.id],
    queryFn: async () =>
      caminoClient?.PChain().getValidatorsAt(proposal.blockHeight),
  });

  return {
    ...proposal,
    error,
    eligibleCMembers: data?.validators,
  };
};
