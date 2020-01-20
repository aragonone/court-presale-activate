const { bigExp } = require('@aragon/court/test/helpers/lib/numbers')
const { DEFAULTS } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)

const ERC20 = artifacts.require('ERC20Mock')
const Presale = artifacts.require('PresaleMock.sol')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const UniswapFactory = artifacts.require('UniswapFactory')

const deployRegistry = async (owner) => {
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  // Controller
  const feeToken = await ERC20.new('Fee Token', 'FT', 18)

  //const controller = await buildHelper().deploy({ minActiveBalance: MIN_ACTIVE_AMOUNT })
  const controller = await artifacts.require('AragonCourtMock').new(
    [DEFAULTS.termDuration, DEFAULTS.firstTermStartTime],
    [owner, owner, owner],
    feeToken.address,
    [DEFAULTS.jurorFee, DEFAULTS.draftFee, DEFAULTS.settleFee],
    [DEFAULTS.evidenceTerms, DEFAULTS.commitTerms, DEFAULTS.revealTerms, DEFAULTS.appealTerms, DEFAULTS.appealConfirmTerms],
    [DEFAULTS.penaltyPct, DEFAULTS.finalRoundReduction],
    [DEFAULTS.firstRoundJurorsNumber, DEFAULTS.appealStepFactor, DEFAULTS.maxRegularAppealRounds, DEFAULTS.finalRoundLockTerms],
    [DEFAULTS.appealCollateralFactor, DEFAULTS.appealConfirmCollateralFactor],
    DEFAULTS.minActiveBalance
  )

  // Token
  const bondedToken = await ERC20.new('Bonded Token', 'BT', 18)

  const registry = await JurorsRegistry.new(controller.address, bondedToken.address, TOTAL_ACTIVE_BALANCE_LIMIT)

  return { bondedToken, registry }
}

const deployPresale = async (owner, collateralToken, bondedToken, exchangeRate) => {

  const presale = await Presale.new(collateralToken.address, bondedToken.address, exchangeRate)
  return { presale }
}

const deployUniswap = async (token) => {
  const uniswapFactory = await UniswapFactory.new()
  await uniswapFactory.createExchange(token.address)

  return { uniswapFactory }
}

const deploy = async ({
  owner,
  exchangeRate,
  collateralToken,
  uniswapFactory
}) => {
  if (!collateralToken) {
    collateralToken = await ERC20.new('Collateral Token', 'CT', 18)
  }

  const { bondedToken, registry } = await deployRegistry(owner)
  const { presale } = await deployPresale(owner, collateralToken, bondedToken, exchangeRate)

  if (!uniswapFactory) {
    uniswapFactory = (await deployUniswap(collateralToken)).uniswapFactory
  }

  return { collateralToken, bondedToken, registry, presale, uniswapFactory }
}

module.exports = {
  deploy,
  deployRegistry,
  deployUniswap
}
