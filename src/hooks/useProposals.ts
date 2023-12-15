import { useQuery, useMutation } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { filter, find, orderBy } from 'lodash';
import { BinTools, platformvm, Buffer } from '@c4tplatform/caminojs/dist';
import { Serialization } from '@c4tplatform/caminojs/dist/utils/serialization';
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
import { useNetworkStore } from '@/store/network';
import useWallet from './useWallet';
import useToast from './useToast';
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
    let target;
    if (proposal.data) {
      const data = serialization.typeToBuffer(proposal.data, 'base64');
      switch (proposalType) {
        case ProposalTypes.NewMember:
          target = JSON.parse(data.toString());
          break;
        case ProposalTypes.ExcludeMember:
          target = JSON.parse(data.toString());
          break;
        default:
          console.warn('Unknown data of proposal to process', data);
      }
    }
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
      target,
      inactive,
      isCompleted,
      isAdminProposal: proposal.admin_proposal,
      description: serialization
        .typeToBuffer(proposal.memo, 'base64')
        .toString(),
    };
  }
  return;
};
const parseAPIProposals = (
  proposals?: APIPRoposalWrapper[],
  currentWalletAddress?: string
) => {
  if (!proposals) return [];
  return proposals.map(proposalWrapper => {
    const proposal = parseAPIProposal(proposalWrapper.dacProposal);
    const votes = proposalWrapper.dacVotes.map(vote => parseAPIVote(vote));
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
const parseAPIVote = (vote: APIVote) => {
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

export const useActiveVotings = (
  pchainAPI?: platformvm.PlatformVMAPI,
  currentWalletAddress?: string,
  page = 0
) => {
  const { data, isInitialLoading, isFetching, refetch, error } = useQuery(
    ['getActiveVotings', currentWalletAddress, page],
    async () => {
      const result = await fetchActiveVotings(page);
      let proposals = parseAPIProposals(
        result?.data.dacProposals,
        currentWalletAddress
      );
      if (pchainAPI && currentWalletAddress) {
        proposals = await Promise.all(
          proposals.map(async proposal => {
            const response = await pchainAPI?.getValidatorsAt(
              proposal.blockHeight
            );
            const canVote = !!find(
              response?.validators,
              validator =>
                validator.consortiumMemberAddress === currentWalletAddress
            );
            return {
              ...proposal,
              canVote: canVote && !proposal.voted,
            };
          })
        );
      }
      return proposals;
    }
  );

  return {
    isFetching,
    isInitialLoading,
    error,
    refetch,
    proposals: data ?? [],
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
  const { data, isFetching, error, refetch } = useQuery(
    ['getCompletedVotes', type, startTime, endTime, page],
    async () => fetchCompletedVotes(type, startTime, endTime),
    {
      refetchOnWindowFocus: false,
      // notifyOnChangeProps: ['data', 'error'],
    }
  );
  const proposals = parseAPIProposals(data?.data.dacProposals);
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

export const useProposal = (
  id: string,
  currentWalletAddress?: string,
  pchainAPI?: platformvm.PlatformVMAPI
) => {
  const { data, isLoading, error, refetch } = useQuery(
    ['getProposalDetail', currentWalletAddress, id],
    async () => {
      const result = await fetchProposalDetail(id);
      const proposal = parseAPIProposal(result?.data?.dacProposal);
      if (pchainAPI && currentWalletAddress && proposal) {
        const response = await pchainAPI?.getValidatorsAt(proposal.blockHeight);
        const canVote = !!find(
          response?.validators,
          validator =>
            validator.consortiumMemberAddress === currentWalletAddress
        );
        const votes = result?.data?.dacVotes.map((vote: APIVote) =>
          parseAPIVote(vote)
        );

        // Find voted by current wallet
        const voted = find(votes, { voterAddr: currentWalletAddress });
        return {
          ...proposal,
          canVote: canVote && !proposal.voted,
          voted: voted?.votedOptions.map((v: number) => ({ option: v })),
          votes,
        };
      }

      return proposal ?? {};
    },
    {
      notifyOnChangeProps: ['data', 'error'],
    }
  );

  return {
    proposal: data ?? {},
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
      targetAddress,
    }: {
      startDate: DateTime;
      endDate: DateTime;
      votingOptions?: VotingOption[];
      description?: string;
      targetAddress?: string;
    }) => {
      let proposal: platformvm.Proposal;
      switch (proposalType) {
        case 0:
          proposal = new platformvm.BaseFeeProposal(
            startDate.startOf('day').toUnixInteger(),
            endDate.endOf('day').toUnixInteger()
          );
          votingOptions
            ?.map((opt: VotingOption) => opt.value)
            .forEach(opt =>
              (proposal as platformvm.BaseFeeProposal).addBaseFeeOption(
                Number(opt)
              )
            );
          break;
        case 1:
          startDate = startDate.startOf('day');
          endDate = endDate.startOf('day');
          proposal = new platformvm.AddMemberProposal(
            startDate.toUnixInteger(),
            endDate.toUnixInteger(),
            targetAddress
          );
          break;
        case 2:
          startDate = startDate.startOf('day');
          endDate = endDate.startOf('day');
          proposal = new platformvm.ExcludeMemberProposal(
            startDate.toUnixInteger(),
            endDate.toUnixInteger(),
            targetAddress
          );
          break;
        case 3:
          {
            startDate = startDate.plus({ hours: 2 });
            endDate = startDate.plus({ days: 60 });
            const optionIndex = Buffer.alloc(4);
            optionIndex.writeInt32BE(0, 0);
            proposal = new platformvm.AdminProposal(
              optionIndex,
              new platformvm.AddMemberProposal(
                startDate.toUnixInteger(),
                endDate.toUnixInteger(),
                targetAddress
              )
            );
          }
          break;
        case 4:
          {
            startDate = startDate.plus({ hours: 2 });
            endDate = startDate.plus({ days: 7 });
            const optionIndex = Buffer.alloc(4);
            optionIndex.writeInt32BE(0, 0);
            proposal = new platformvm.AdminProposal(
              optionIndex,
              new platformvm.ExcludeMemberProposal(
                startDate.toUnixInteger(),
                endDate.toUnixInteger(),
                targetAddress
              )
            );
          }
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
          serialization.typeToBuffer(description, 'utf8')
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
  const caminoClient = useNetworkStore(state => state.caminoClient);
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
