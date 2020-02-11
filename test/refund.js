const { assertRevert } = require('@aragon/court/test/helpers/asserts/assertThrow')
const getBalance = require('@aragon/test-helpers/balance')(web3)
const { bn, bigExp } = require('@aragon/court/test/helpers/lib/numbers')

const { deploy } = require('./helpers/deploy')

const ERC20 = artifacts.require('ERC20Mock')
const ERC20Bad = artifacts.require('ERC20BadMock')
const SelfDestruct = artifacts.require('SelfDestructMock')
const NonPayable = artifacts.require('NonPayableMock')
const Refundable = artifacts.require('Refundable')

contract('Refundable', ([_, owner, juror1]) => {
  let refundable

  const ERROR_NOT_GOVERNOR = 'REF_NOT_GOVERNOR'
  const ERROR_ETH_REFUND = 'REF_ETH_REFUND'
  const ERROR_TOKEN_REFUND = 'REF_TOKEN_REFUND'
  const ERROR_NOT_ENOUGH_BALANCE = 'REF_NOT_ENOUGH_BALANCE'
  const ERROR_ZERO_AMOUNT = 'REF_ZERO_AMOUNT'

  context('Refund accidentally sent tokens', () => {
    const amount = bigExp(1, 17)

    beforeEach('Deploy contract', async () => {
      // deploy
      refundable = await Refundable.new(owner, { from: owner })
    })

    context('ETH', () => {
      beforeEach('Send funds', async () => {
        const selfDestruct = await SelfDestruct.new()
        await selfDestruct.sendTransaction({ value: amount })
        await selfDestruct.selfDestruct(refundable.address)
      })

      it('recovers funds', async () => {
        assert.isTrue(bn(await getBalance(refundable.address)).gt(bn(0)), 'Wrapper ETH balance should be greater than zero before refund')
        await refundable.refundEth(juror1, amount, { from: owner })
        assert.equal(await getBalance(refundable.address), '0', 'Wrapper ETH balance should always be zero')
      })

      it('fails if non-governor tries to refund', async () => {
        await assertRevert(refundable.refundEth(juror1, amount, { from: juror1 }), ERROR_NOT_GOVERNOR)
      })

      it('fails if requested amount to refund  zero', async () => {
        await assertRevert(refundable.refundEth(juror1, 0, { from: owner }), ERROR_ZERO_AMOUNT)
      })

      it('fails if refunded amount is greater than balance', async () => {
        await assertRevert(refundable.refundEth(juror1, amount.add(bn(1)), { from: owner }), ERROR_NOT_ENOUGH_BALANCE)
      })

      it('fails if transfer to recipient fails', async () => {
        const nonPayable = await NonPayable.new()
        await assertRevert(refundable.refundEth(nonPayable.address, amount, { from: owner }), ERROR_ETH_REFUND)
      })
    })

    context('ECR20 tokens', () => {
      let collateralToken

      beforeEach('Send funds', async () => {
        collateralToken = await ERC20.new('Collateral Token', 'CT', 18)
        await collateralToken.mint(juror1, amount)
        await collateralToken.transfer(refundable.address, amount, { from: juror1 })
      })

      it('recovers funds', async () => {
        assert.isTrue((await collateralToken.balanceOf(refundable.address)).gt(bn(0)), 'Wrapper collateral token balance should be greater than zero before refund')
        await refundable.refundToken(collateralToken.address, juror1, amount, { from: owner })
        assert.equal((await collateralToken.balanceOf(refundable.address)).toNumber(), 0, 'Wrapper collateral token balance should be zero')
      })

      it('fails if non-governor tries to refund', async () => {
        await assertRevert(refundable.refundToken(collateralToken.address, juror1, amount, { from: juror1 }), ERROR_NOT_GOVERNOR)
      })

      it('fails if requested amount to refund is zero', async () => {
        await assertRevert(refundable.refundToken(collateralToken.address, juror1, 0, { from: owner }), ERROR_ZERO_AMOUNT)
      })

      it('fails if refunded amount is greater than balance', async () => {
        await assertRevert(refundable.refundToken(collateralToken.address, juror1, amount.add(bn(1)), { from: owner }), ERROR_NOT_ENOUGH_BALANCE)
      })

      it('fails if transfer to recipient fails', async () => {
        // deploy bad tokens and send funds
        const badCollateralToken = await ERC20Bad.new('Collateral Bad Token', 'CBT', 18)
        await badCollateralToken.mint(refundable.address, amount)
        await badCollateralToken.setTransferMisbehave(true)

        await assertRevert(refundable.refundToken(badCollateralToken.address, juror1, amount, { from: owner }), ERROR_TOKEN_REFUND)
      })
    })
  })

})
