const { assertBn } = require('@aragon/court/test/helpers/asserts/assertBn')
const { assertRevert } = require('@aragon/court/test/helpers/asserts/assertThrow')
//const { buildHelper } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { DEFAULTS } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { bn, bigExp } = require('@aragon/court/test/helpers/lib/numbers')

const { deploy } = require('./helpers/deploy')

const CourtPresaleActivate = artifacts.require('CourtPresaleActivate')

contract('Court presale and activate wrapper', ([_, owner, juror1, juror2, juror3]) => {
  let collateralToken, bondedToken, registry, presale

  const ZERO_ADDRESS = '0x' + '0'.repeat(40)

  const ERROR_TOKEN_NOT_CONTRACT = 'CPA_TOKEN_NOT_CONTRACT'
  const ERROR_REGISTRY_NOT_CONTRACT = 'CPA_REGISTRY_NOT_CONTRACT'
  const ERROR_PRESALE_NOT_CONTRACT = 'CPA_PRESALE_NOT_CONTRACT'
  const ERROR_ZERO_AMOUNT = 'CPA_ZERO_AMOUNT'

  const INITIAL_BIG_TOKEN_AMOUNT = bigExp(1, 24)
  const exchangeRate = bn(200)
  const PPM = bn(1000000)

  before('Deploy token, registry and presale', async () => {
    ({ collateralToken, bondedToken, registry, presale } = await deploy(owner, exchangeRate))
    await collateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
  })

  context('Deployment fails', () => {
    it('fails when bonded token is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(ZERO_ADDRESS, registry.address, presale.address), ERROR_TOKEN_NOT_CONTRACT)
    })

    it('fails when registry is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(bondedToken.address, ZERO_ADDRESS, presale.address), ERROR_REGISTRY_NOT_CONTRACT)
    })

    it('fails when presale is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(bondedToken.address, registry.address, ZERO_ADDRESS), ERROR_PRESALE_NOT_CONTRACT)
    })
  })

  context('Succesfully deployed', () => {
    let cpa

    beforeEach('Deploy airdrop contract', async () => {
      // deploy
      cpa = await CourtPresaleActivate.new(bondedToken.address, registry.address, presale.address, { from: owner })
    })

    it('fails when amount is zero', async () => {
      await assertRevert(collateralToken.approveAndCall(cpa.address, 0, '0x00'), ERROR_ZERO_AMOUNT)
    })

    it('buys, stakes and activates', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
      const initialActiveAmount = (await registry.balanceOf(juror1))[0]
      const bondedTokensToGet = await presale.contributionToTokens(amount);

      await collateralToken.approveAndCall(cpa.address, amount, '0x00', { from: juror1 })

      const finalActiveAmount = (await registry.balanceOf(juror1))[0]
      assertBn(finalActiveAmount, initialActiveAmount.add(bondedTokensToGet), `Active balance `)
    })
  })
})
