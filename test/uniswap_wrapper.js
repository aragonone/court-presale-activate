const { assertBn } = require('@aragon/court/test/helpers/asserts/assertBn')
const { assertRevert } = require('@aragon/court/test/helpers/asserts/assertThrow')
const getBalance = require('@aragon/test-helpers/balance')(web3)
const getBlockNumber = require('@aragon/test-helpers/blockNumber')(web3)
const getBlock = require('@aragon/test-helpers/block')(web3)
const { DEFAULTS } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { bn, bigExp } = require('@aragon/court/test/helpers/lib/numbers')

const { deploy } = require('./helpers/deploy')

const ERC20 = artifacts.require('ERC20Mock')
const ERC20Bad = artifacts.require('ERC20BadMock')
const UniswapFactory = artifacts.require('UniswapFactory')
const UniswapExchange = artifacts.require('UniswapExchange')
const UniswapWrapper = artifacts.require('RegistryBuyAndStakeWrapper')

const getDeadline = async () => bn((await getBlock(await getBlockNumber())).timestamp).add(bn(86400))


contract('Court Uniswap wrapper', ([_, owner, provider, juror1]) => {
  const ZERO_ADDRESS = '0x' + '0'.repeat(40)

  const ERROR_TOKEN_NOT_CONTRACT = 'RBSW_TOKEN_NOT_CONTRACT'
  const ERROR_REGISTRY_NOT_CONTRACT = 'RBSW_REGISTRY_NOT_CONTRACT'
  const ERROR_UNISWAP_FACTORY_NOT_CONTRACT = 'RBSW_UNISWAP_FACTORY_NOT_CONTRACT'
  const ERROR_ZERO_AMOUNT = 'RBSW_ZERO_AMOUNT'
  const ERROR_TOKEN_TRANSFER_FAILED = 'RBSW_TOKEN_TRANSFER_FAILED'
  const ERROR_TOKEN_APPROVAL_FAILED = 'RBSW_TOKEN_APPROVAL_FAILED'
  const ERROR_UNISWAP_UNAVAILABLE = 'RBSW_UNISWAP_UNAVAILABLE'

  const INITIAL_BIG_TOKEN_AMOUNT = bigExp(1, 24)
  const exchangeRate = bn(200000)
  const PPM = bn(1000000)

  context('Regular tokens', () => {
    let bondedToken, registry, uniswapFactory, presale

    beforeEach('Deploy token, registry and presale', async () => {
      ({ bondedToken, registry, presale, uniswapFactory } = await deploy({ owner, exchangeRate }))
    })

    const testContribute = (activate) => {
      let uniswapWrapper
      const activateData = activate ? '0x01' : '0x'
      const activateDescription = activate ? ' and activates' : ''

      beforeEach('Deploy airdrop contract', async () => {
        // deploy
        uniswapWrapper = await UniswapWrapper.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })

        // close presale
        await presale.close()
      })

      let uniswapBondedExchange

      const addLiquidity = async (token) => {
        const ethAmount = bigExp(1, 18)
        const uniswapExchangeAddress = await uniswapFactory.getExchange(token.address)
        const uniswapExchange = await UniswapExchange.at(uniswapExchangeAddress)
        await token.mint(provider, INITIAL_BIG_TOKEN_AMOUNT)
        await token.approve(uniswapExchangeAddress, INITIAL_BIG_TOKEN_AMOUNT, { from: provider })
        await uniswapExchange.addLiquidity(0, INITIAL_BIG_TOKEN_AMOUNT, await getDeadline(), { from: provider, value: ethAmount })

        return uniswapExchange
      }

      beforeEach('Create Uniswap liquidity pools', async () => {
        await uniswapFactory.createExchange(bondedToken.address)
        uniswapBondedExchange = await addLiquidity(bondedToken)
      })

      context('External token', () => {
        let externalToken, uniswapExternalExchange

        beforeEach('Deploy external token, mint and create Uniswap exchange', async () => {
          externalToken = await ERC20.new('External Token', 'ET', 18)
          await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
          // set up in Uniswap
          await uniswapFactory.createExchange(externalToken.address)
          uniswapExternalExchange = await addLiquidity(externalToken)
        })

        context('Using ApproveAndCall fallback', () => {
          const getApproveAndCallData = async (activate) =>
                '0x' +
                '0'.repeat(63) + (activate ? '1' : '0') +            // activate
                '0'.repeat(63) + '1' +                               // minTokens
                '0'.repeat(63) + '1' +                               // minEth
                (await getDeadline()).toString().padStart(64, '0')   // deadline

          it('fails when amount is zero', async () => {
            const approveAndCallData = await getApproveAndCallData(activate)
            await assertRevert(externalToken.approveAndCall(uniswapWrapper.address, 0, approveAndCallData, { from: juror1 }), ERROR_ZERO_AMOUNT)
          })

          it('buys, stakes' + activateDescription, async () => {
            const approveAndCallData = await getApproveAndCallData(activate)
            const externalAmount = bigExp(1, 21)
            const ethAmount = await uniswapExternalExchange.getTokenToEthInputPrice(externalAmount)
            const bondedAmount = await uniswapExternalExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]

            await externalToken.approveAndCall(uniswapWrapper.address, externalAmount, approveAndCallData, { from: juror1 })

            const finalActiveAmount = (await registry.balanceOf(juror1))[0]
            const expectedActiveAmount = activate ? initialActiveAmount.add(bondedAmount) : bn(0)
            assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
            assert.equal((await externalToken.balanceOf(uniswapWrapper.address)).toNumber(), 0, 'Wrapper external token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(uniswapWrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })
        })

        context('In two transactions', () => {
          it('fails when amount is zero', async () => {
            await assertRevert(uniswapWrapper.contributeExternalToken(0, externalToken.address, 1, 1, await getDeadline(), activate, { from: juror1 }), ERROR_ZERO_AMOUNT)
          })

          it('buys, stakes' + activateDescription, async () => {
            const externalAmount = bigExp(1, 21)
            const ethAmount = await uniswapExternalExchange.getTokenToEthInputPrice(externalAmount)
            const bondedAmount = await uniswapExternalExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]

            await externalToken.approve(uniswapWrapper.address, externalAmount, { from: juror1 })
            await uniswapWrapper.contributeExternalToken(externalAmount, externalToken.address, 1, 1, await getDeadline(), activate, { from: juror1 })

            const finalActiveAmount = (await registry.balanceOf(juror1))[0]
            const expectedActiveAmount = activate ? initialActiveAmount.add(bondedAmount) : bn(0)
            assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
            assert.equal((await externalToken.balanceOf(uniswapWrapper.address)).toNumber(), 0, 'Wrapper external token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(uniswapWrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })
        })
      })

      context('ETH', () => {
        const ETH = '0x' + '0'.repeat(40)

        it('fails when amount is zero', async () => {
          await assertRevert(uniswapWrapper.contributeEth(1, await getDeadline(), activate, { from: juror1, value: 0 }), ERROR_ZERO_AMOUNT)
        })

        it('buys, stakes' + activateDescription, async () => {
          const ethAmount = bigExp(1, 16)
          const bondedAmount = await uniswapBondedExchange.getEthToTokenInputPrice(ethAmount)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]

          await uniswapWrapper.contributeEth(1, await getDeadline(), activate, { from: juror1, value: ethAmount })

          const finalActiveAmount = (await registry.balanceOf(juror1))[0]
          const expectedActiveAmount = activate ? initialActiveAmount.add(bondedAmount) : bn(0)
          assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
          assert.equal(await getBalance(uniswapWrapper.address), '0', 'Wrapper ETH balance should always be zero')
          assert.equal((await bondedToken.balanceOf(uniswapWrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
        })
      })
    }

    context('Succesfully deployed', () => {
      context('Activates tokens', () => {
        testContribute(true)
      })

      context('Doesn\'t activate tokens', () => {
        testContribute(false)
      })
    })
  })

  context('Bad tokens', () => {
    let uniswapWrapper, badExternalToken

    beforeEach('Deploy airdrop contract', async () => {
      // deploy bad token
      badExternalToken = await ERC20Bad.new('External Bad Token', 'EBT', 18)
      await badExternalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT);

      const { bondedToken, registry, presale, uniswapFactory } = await deploy({ owner, exchangeRate })

      // set up in Uniswap
      await uniswapFactory.createExchange(badExternalToken.address)

      // deploy wrapper
      uniswapWrapper = await UniswapWrapper.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })

      // close presale
      await presale.close()
    })

    it('contribute external token fails if collateral token approve fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(uniswapWrapper.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setApproveMisbehave(true)

      await assertRevert(uniswapWrapper.contributeExternalToken(externalAmount, badExternalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_APPROVAL_FAILED)
    })

    it('contribute external token fails if collateral token transfer fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(uniswapWrapper.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setTransferMisbehave(true)

      await assertRevert(uniswapWrapper.contributeExternalToken(externalAmount, badExternalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })
  })

  context('Without Uniswap exchange', () => {
    let uniswapWrapper

    beforeEach('Deploy airdrop contract', async () => {
      const uniswapFactory = await UniswapFactory.new()
      const { bondedToken, registry, presale } = await deploy({ owner, exchangeRate, uniswapFactory })

      // deploy wrapper
      uniswapWrapper = await UniswapWrapper.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })

      // close presale
      await presale.close()
    })

    context('External token', () => {
      let externalToken

      beforeEach('deploy external token, mint and create Uniswap exchange', async () => {
        externalToken = await ERC20.new('External Token', 'ET', 18)
        await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
      })

      it('fails when there is no Uniswap exchange', async () => {
        const externalAmount = bigExp(1, 21)
        await externalToken.approve(uniswapWrapper.address, externalAmount, { from: juror1 })
        await assertRevert(uniswapWrapper.contributeExternalToken(externalAmount, externalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })

    context('ETH', () => {
      const ETH = '0x' + '0'.repeat(40)

      it('fails when there is no Uniswap exchange', async () => {
        const ethAmount = bigExp(1, 16)
        await assertRevert(uniswapWrapper.contributeEth(1, await getDeadline(), true, { from: juror1, value: ethAmount }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })
  })

})
