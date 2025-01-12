import BigNumber from 'bignumber.js'

import { MAX_UINT, ZERO } from '../../helpers/constants'
import { getZeroSwap } from '../../helpers/swap/getZeroSwap'
import { AAVEStrategyAddresses } from '../../operations/aave/v2'
import {
  IBasePositionTransitionArgs,
  IPositionTransition,
  IPositionTransitionDependencies,
  WithPaybackDebt,
  WithWithdrawCollateral,
} from '../../types'
import { AAVETokens } from '../../types/aave'
import * as operations from './../../operations'
import { getAaveTokenAddresses } from './getAaveTokenAddresses'

export async function paybackWithdraw(
  args: IBasePositionTransitionArgs<AAVETokens> & WithWithdrawCollateral & WithPaybackDebt,
  dependencies: IPositionTransitionDependencies<AAVEStrategyAddresses>,
): Promise<IPositionTransition> {
  const currentPosition = dependencies.currentPosition

  const { collateralTokenAddress, debtTokenAddress } = getAaveTokenAddresses(
    { debtToken: args.debtToken, collateralToken: args.collateralToken },
    dependencies.addresses,
  )

  const transaction = await operations.aave.v2.paybackWithdraw({
    amountCollateralToWithdrawInBaseUnit: currentPosition.collateral.amount.lte(
      args.amountCollateralToWithdrawInBaseUnit,
    )
      ? new BigNumber(MAX_UINT)
      : args.amountCollateralToWithdrawInBaseUnit,
    amountDebtToPaybackInBaseUnit: args.amountDebtToPaybackInBaseUnit,
    isPaybackAll: args.amountDebtToPaybackInBaseUnit.gte(currentPosition.debt.amount),
    collateralTokenAddress: collateralTokenAddress,
    debtTokenAddress: debtTokenAddress,
    collateralIsEth: currentPosition.collateral.symbol === 'ETH',
    debtTokenIsEth: currentPosition.debt.symbol === 'ETH',
    proxy: dependencies.proxy,
    user: dependencies.user,
    isDPMProxy: dependencies.isDPMProxy,
    addresses: dependencies.addresses,
  })

  const finalPosition = currentPosition
    .payback(args.amountDebtToPaybackInBaseUnit)
    .withdraw(args.amountCollateralToWithdrawInBaseUnit)

  const flags = {
    requiresFlashloan: false,
    isIncreasingRisk: currentPosition.riskRatio.loanToValue.lt(finalPosition.riskRatio.loanToValue),
  }

  return {
    transaction: transaction,
    simulation: {
      delta: {
        debt: currentPosition.debt.amount.plus(args.amountDebtToPaybackInBaseUnit),
        collateral: currentPosition.collateral.amount.minus(
          args.amountCollateralToWithdrawInBaseUnit,
        ),
        flashloanAmount: ZERO,
      },
      swap: getZeroSwap(args.collateralToken.symbol, args.debtToken.symbol),
      flags: flags,
      position: finalPosition,
      minConfigurableRiskRatio: finalPosition.riskRatio, // TODO: Change to min risk ratio
    },
  }
}
