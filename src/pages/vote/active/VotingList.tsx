import React, { useState } from 'react';
import { List, ListItemButton } from '@mui/material';
import { ArrowForwardIos } from '@mui/icons-material';
import type { Proposal } from '@/types';
import NewMemberVoting from './NewMemberVoting';
import BaseFeeVoting from './BaseFeeVoting';
import ListItemDuration from '@/components/ListItemDuration';

interface VotingListProps {
  data: { type: string; name: string; data: Proposal[] };
}
const VotingList = ({ data }: VotingListProps) => {
  const [disableRipple, setDisableRipple] = useState(false);
  return (
    <List disablePadding>
      {data.data.map((proposal: Proposal, index: number) => {
        let Vote: JSX.Element | null = null;
        switch (data.type) {
          case 'NEW_MEMBER':
            Vote = <NewMemberVoting data={proposal} />;
            break;
          case 'BASE_FEE':
            Vote = <BaseFeeVoting data={proposal} />;
            break;
          default:
            console.warn(`Unsupport voting type ${data.type}`);
        }
        return (
          <ListItemButton
            key={proposal.id}
            divider={index !== data.data.length - 1}
            disableRipple
            onClick={() => console.log('go detail')}
          >
            <ListItemDuration
              startTimestamp={proposal.startDateTime}
              endTimestamp={proposal.endDateTime}
            />
            {Vote}
            <ArrowForwardIos />
          </ListItemButton>
        );
      })}
    </List>
  );
};
export default VotingList;