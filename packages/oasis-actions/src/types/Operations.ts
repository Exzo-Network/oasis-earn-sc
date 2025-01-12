import BigNumber from 'bignumber.js'

import { OperationNames } from '../helpers/constants'
import { AAVEStrategyAddresses } from '../operations/aave/v2'
import { AAVEV3StrategyAddresses } from '../operations/aave/v3'
import { ActionCall } from './actionCall'
import { FlashloanProvider } from './common'
import { PositionType } from './PositionType'
import { Address } from './StrategyParams'

export interface IOperation {
  calls: ActionCall[]
  operationName: OperationNames
}

export type WithCollateral = {
  collateral: {
    address: Address
    isEth: boolean
  }
}

export type WithCollateralAndWithdrawal = {
  collateral: WithCollateral['collateral'] & WithWithdrawal
}

export type WithDebt = {
  debt: {
    address: Address
    isEth: boolean
  }
}

export type WithDebtAndBorrow = {
  debt: WithDebt['debt'] & WithBorrowing
}

export type WithBorrowing = {
  borrow: {
    /* Amount to borrow in base unit */
    amount: BigNumber
  }
}

export type WithWithdrawal = {
  withdrawal: {
    /* Amount to withdraw in base unit */
    amount: BigNumber
  }
}

export type WithDeposit = {
  deposit: {
    address: Address
    /* Amount to deposit in base unit */
    amount: BigNumber
  }
}

export type WithOptionalDeposit = Partial<WithDeposit>

export type WithSwap = {
  swap: {
    fee: number
    data: string | number
    /* Amount to swap in base unit */
    amount: BigNumber
    collectFeeFrom: 'sourceToken' | 'targetToken'
    receiveAtLeast: BigNumber
  }
}

export type WithFlashloan = {
  flashloan: {
    provider: FlashloanProvider
    amount: BigNumber
  }
}

export type WithOptionalFlashloan = Partial<WithFlashloan>

export type WithProxy = {
  proxy: {
    address: string
    owner: string
    isDPMProxy: boolean
  }
}

export type WithPosition = {
  position: {
    type: PositionType
  }
}

export type WithAaveV2StrategyAddresses = {
  addresses: AAVEStrategyAddresses
}

export type WithAaveV3StrategyAddresses = {
  addresses: AAVEV3StrategyAddresses
}

export type WithEMode = {
  /*
   * Categories are voted on by the community and categorised as an integer
   * 0 is the default category with no special treatment
   * */
  emode: {
    categoryId: number
  }
}
