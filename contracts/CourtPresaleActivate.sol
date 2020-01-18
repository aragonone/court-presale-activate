pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/IsContract.sol";
import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/standards/ApproveAndCall.sol";
import "@aragon/court/contracts/standards/ERC900.sol";
import "./lib/IPresale.sol";
import "./lib/uniswap/interfaces/IUniswapExchange.sol";
import "./lib/uniswap/interfaces/IUniswapFactory.sol";


contract CourtPresaleActivate is IsContract, ApproveAndCallFallBack {
    using SafeERC20 for ERC20;

    string private constant ERROR_TOKEN_NOT_CONTRACT = "CPA_TOKEN_NOT_CONTRACT";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "CPA_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_PRESALE_NOT_CONTRACT = "CPA_PRESALE_NOT_CONTRACT";
    string private constant ERROR_UNISWAP_FACTORY_NOT_CONTRACT = "CPA_UNISWAP_FACTORY_NOT_CONTRACT";
    string private constant ERROR_ZERO_AMOUNT = "CPA_ZERO_AMOUNT";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CPA_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_TOKEN_APPROVAL_FAILED = "CPA_TOKEN_APPROVAL_FAILED";
    string private constant ERROR_WRONG_TOKEN = "CPA_WRONG_TOKEN";
    string private constant ERROR_ETH_REFUND = "CPA_ETH_REFUND";
    string private constant ERROR_TOKEN_REFUND = "CPA_TOKEN_REFUND";
    string private constant ERROR_UNISWAP_UNAVAILABLE = "CPA_UNISWAP_UNAVAILABLE";

    bytes32 internal constant ACTIVATE_DATA = keccak256("activate(uint256)");

    ERC20 public bondedToken;
    ERC900 public registry;
    IPresale public presale;
    IUniswapFactory public uniswapFactory;

    event BoughtAndActivated(address from, address collateralToken, uint256 buyAmount, uint256 activatedAmount);

    constructor(ERC20 _bondedToken, ERC900 _registry, IPresale _presale, IUniswapFactory _uniswapFactory) public {
        require(isContract(address(_bondedToken)), ERROR_TOKEN_NOT_CONTRACT);
        require(isContract(address(_registry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(isContract(address(_presale)), ERROR_PRESALE_NOT_CONTRACT);
        require(isContract(address(_uniswapFactory)), ERROR_UNISWAP_FACTORY_NOT_CONTRACT);

        bondedToken = _bondedToken;
        registry = _registry;
        presale = _presale;
        uniswapFactory = _uniswapFactory;
    }

    /**
    * @dev This function must be triggered by the contribution token approve-and-call fallback.
    *      It will pull the approved tokens and convert them into the presale instance, and activate the converted tokens into a
    *      jurors registry instance of an Aragon Court.
    * @param _from Address of the original caller (juror) converting and activating the tokens
    * @param _amount Amount of contribution tokens to be converted and activated
    * @param _token Address of the contribution token triggering the approve-and-call fallback
    */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes calldata) external {
        require(_amount > 0, ERROR_ZERO_AMOUNT);
        require(_token == address(presale.contributionToken()), ERROR_WRONG_TOKEN);

        // move tokens to this contract
        ERC20 token = ERC20(_token);
        require(token.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        _buyAndActivate(_from, _amount, _token);

        // refund leftovers if any
        _refund(token);
    }

    /**
    * @dev This function needs a previous approval on the external token used for the contributed amount.
    *      It will pull the approved tokens, convert them in Uniswap to the presale contribution token,
    *      convert the obtained tokens in the presale instance, and activate the converted tokens in the
    *      jurors registry instance of the Aragon Court.
    * @param _token Address of the external contribution token used
    * @param _amount Amount of contribution tokens to be converted and activated
    * @param _minTokens Minimum amount of presale contribution tokens obtained in Uniswap
    * @param _minEth Minimum amount of ETH obtained in Uniswap (Uniswap internally converts first to ETH and then to target token)
    * @param _deadline Transaction deadline for Uniswap
    */
    function contributeExternalToken(
        address _token,
        uint256 _amount,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline
    )
        external
    {
        require(_amount > 0, ERROR_ZERO_AMOUNT);

        // move tokens to this contract
        require(ERC20(_token).safeTransferFrom(msg.sender, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        // get the Uniswap exchange for the contribution token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(_token);
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        // swap tokens
        address contributionTokenAddress = address(presale.contributionToken());
        ERC20 token = ERC20(_token);
        require(token.safeApprove(address(uniswapExchange), _amount), ERROR_TOKEN_APPROVAL_FAILED);
        uint256 contributionTokenAmount = uniswapExchange.tokenToTokenSwapInput(_amount, _minTokens, _minEth, _deadline, contributionTokenAddress);

        // buy in presale
        _buyAndActivate(msg.sender, contributionTokenAmount, contributionTokenAddress);

        // refund leftovers if any
        _refund(token);
        _refund(contributionTokenAddress);
    }

    /**
    * @dev It will send the received ETH to Uniswap to get presale contribution tokens,
    *      convert the obtained tokens in the presale instance, and activate the converted tokens in the
    *      jurors registry instance of the Aragon Court.
    * @param _minTokens Minimum amount of presale contribution tokens obtained in Uniswap
    * @param _deadline Transaction deadline for Uniswap
    */
    function contributeEth(uint256 _minTokens, uint256 _deadline) external payable {
        require(msg.value > 0, ERROR_ZERO_AMOUNT);

        address contributionTokenAddress = address(presale.contributionToken());

        // get the Uniswap exchange for the contribution token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(contributionTokenAddress);
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        // swap tokens
        uint256 contributionTokenAmount = uniswapExchange.ethToTokenSwapInput.value(msg.value)(_minTokens, _deadline);

        // buy in presale
        _buyAndActivate(msg.sender, contributionTokenAmount, contributionTokenAddress);

        // make sure there's no ETH left
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool result,) = msg.sender.call.value(ethBalance)("");
            require(result, ERROR_ETH_REFUND);
        }
    }

    function _buyAndActivate(address _from, uint256 _amount, address _token) internal {
        // approve to presale
        require(ERC20(_token).safeApprove(address(presale), _amount), ERROR_TOKEN_APPROVAL_FAILED);

        // buy in presale
        presale.contribute(address(this), _amount);
        uint256 bondedTokensObtained = presale.contributionToTokens(_amount);

        // activate in registry
        bondedToken.approve(address(registry), bondedTokensObtained);
        registry.stakeFor(_from, bondedTokensObtained, abi.encodePacked(ACTIVATE_DATA));

        // refund leftovers if any
        _refund(bondedToken);

        emit BoughtAndActivated(_from, _token, _amount, bondedTokensObtained);
    }

    function _refund(address _tokenAddress) internal {
        ERC20 token = ERC20(_tokenAddress);
        _refund(token);
    }

    function _refund(ERC20 _token) internal {
        uint256 selfBalance = _token.balanceOf(address(this));
        if (selfBalance > 0) {
            require(_token.safeTransfer(msg.sender, selfBalance), ERROR_TOKEN_REFUND);
        }
    }
}
