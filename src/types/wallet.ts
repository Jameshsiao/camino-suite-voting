import { BN, Buffer } from '@c4tplatform/caminojs/dist';
import {
  UTXOSet as AVMUTXOSet,
  KeyPair as AVMKeyPair,
  KeyChain as AVMKeyChain,
} from '@c4tplatform/caminojs/dist/apis/avm';
import {
  UTXOSet as PlatformUTXOSet,
  KeyChain as PlatformKeyChain,
  KeyPair as PlatformKeyPair,
  Owner,
} from '@c4tplatform/caminojs/dist/apis/platformvm';
import { KeyChain as EVMKeyChain } from '@c4tplatform/caminojs/dist/apis/evm';

export type WalletType = 'singleton' | 'multisig';

type WalletCore = {
  id: string;
  name: string;
  type?: WalletType;
  accountHash?: Buffer;
  keyPair?: AVMKeyPair;

  utxoset: AVMUTXOSet;
  platformUtxoset: PlatformUTXOSet;
  stakeAmount: BN;

  isFetchUtxos: boolean;
  isInit: boolean;

  getAllAddressesP: () => string[];
};

interface KeyData {
  alias: Buffer;
  memo: string;
  owner: Owner;
}

export type SingletonWallet = WalletCore & {
  keyChain: AVMKeyChain;

  platformKeyChain: PlatformKeyChain;
  platformKeyPair: PlatformKeyPair;

  chainId: string;
  chainIdP: string;

  key: string;
  seed: string;
  mnemonic: string;

  stakeAmount: BN;

  type: WalletType;

  ethKey: string;
  ethKeyBech: string;
  ethKeyChain: EVMKeyChain;
  ethAddress: string;
  ethAddressBech: string;
  ethBalance: BN;
};

export type MultisigWallet = WalletCore & {
  type: WalletType;
  chainId: string;
  pchainId: string;
  ethAddress: string;
  ethBalance: BN;

  keyData: KeyData;
  wallets: WalletCore[];
  unlinkedOwners: Buffer[];
  hrp: string;
};

export type Wallet = SingletonWallet | MultisigWallet;
