pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/IsContract.sol";
import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/standards/ERC900.sol";
import "./lib/uniswap/interfaces/IUniswapExchange.sol";
import "./lib/uniswap/interfaces/IUniswapFactory.sol";


contract UniswapWrapper is IsContract {
    using SafeERC20 for ERC20;

    string private constant ERROR_TOKEN_NOT_CONTRACT = "UW_TOKEN_NOT_CONTRACT";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "UW_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_UNISWAP_FACTORY_NOT_CONTRACT = "UW_UNISWAP_FACTORY_NOT_CONTRACT";
    string private constant ERROR_RECEIVED_WRONG_TOKEN = "UW_RECEIVED_WRONG_TOKEN";
    string private constant ERROR_ZERO_AMOUNT = "UW_ZERO_AMOUNT";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "UW_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_TOKEN_APPROVAL_FAILED = "UW_TOKEN_APPROVAL_FAILED";
    string private constant ERROR_ETH_REFUND = "UW_ETH_REFUND";
    string private constant ERROR_TOKEN_REFUND = "UW_TOKEN_REFUND";
    string private constant ERROR_UNISWAP_UNAVAILABLE = "UW_UNISWAP_UNAVAILABLE";

    bytes32 internal constant ACTIVATE_DATA = keccak256("activate(uint256)");

    ERC20 public bondedToken;
    ERC900 public registry;
    IUniswapFactory public uniswapFactory;

    constructor(ERC20 _bondedToken, ERC900 _registry, IUniswapFactory _uniswapFactory) public {
        require(isContract(address(_bondedToken)), ERROR_TOKEN_NOT_CONTRACT);
        require(isContract(address(_registry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(isContract(address(_uniswapFactory)), ERROR_UNISWAP_FACTORY_NOT_CONTRACT);

        bondedToken = _bondedToken;
        registry = _registry;
        uniswapFactory = _uniswapFactory;
    }

    /**
    * @dev This function must be triggered by an external token's approve-and-call fallback.
    *      It will pull the approved tokens and convert them in Uniswap, and activate the converted
    *      tokens into a jurors registry instance of an Aragon Court.
    * @param _from Address of the original caller (juror) converting and activating the tokens
    * @param _amount Amount of external tokens to be converted and activated
    * @param _token Address of the external token triggering the approve-and-call fallback
    * @param _data If non-empty it will signal token activation in the registry
    */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes calldata _data) external {
        require(_token == msg.sender, ERROR_RECEIVED_WRONG_TOKEN);

        bool activate;
        uint256 minTokens;
        uint256 minEth;
        uint256 deadline;
        bytes memory data = _data;
        assembly {
            activate := mload(add(data, 0x20))
            minTokens := mload(add(data, 0x40))
            minEth := mload(add(data, 0x60))
            deadline := mload(add(data, 0x80))
        }

        _contributeExternalToken(_from, _amount, _token, minTokens, minEth, deadline, activate);
    }

    /**
    * @dev This function needs a previous approval on the external token used for the contributed amount.
    *      It will pull the approved tokens, convert them in Uniswap to the bonded token,
    *      and activate the converted tokens in the jurors registry instance of the Aragon Court.
    * @param _token Address of the external contribution token used
    * @param _amount Amount of contribution tokens to be converted and activated
    * @param _minTokens Minimum amount of bonded tokens obtained in Uniswap
    * @param _minEth Minimum amount of ETH obtained in Uniswap (Uniswap internally converts first to ETH and then to target token)
    * @param _deadline Transaction deadline for Uniswap
    * @param _activate Signal activation of tokens in the registry
    */
    function contributeExternalToken(
        uint256 _amount,
        address _token,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline,
        bool _activate
    )
        external
    {
        _contributeExternalToken(msg.sender, _amount, _token, _minTokens, _minEth, _deadline, _activate);
    }

    /**
    * @dev It will send the received ETH to Uniswap to get bonded tokens,
    *      and activate the converted tokens in the jurors registry instance of the Aragon Court.
    * @param _minTokens Minimum amount of bonded tokens obtained in Uniswap
    * @param _deadline Transaction deadline for Uniswap
    * @param _activate Signal activation of tokens in the registry
    */
    function contributeEth(uint256 _minTokens, uint256 _deadline, bool _activate) external payable {
        require(msg.value > 0, ERROR_ZERO_AMOUNT);

        // get the Uniswap exchange for the bonded token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(address(bondedToken));
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        // swap tokens
        uint256 bondedTokenAmount = uniswapExchange.ethToTokenSwapInput.value(msg.value)(_minTokens, _deadline);

        // stake and activate in the registry
        _stakeAndActivate(msg.sender, bondedTokenAmount, _activate);

        // make sure there's no ETH left
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            // solium-disable security/no-call-value
            (bool result,) = msg.sender.call.value(ethBalance)("");
            require(result, ERROR_ETH_REFUND);
        }
    }

    function _contributeExternalToken(
        address _from,
        uint256 _amount,
        address _token,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline,
        bool _activate
    )
        internal
    {
        require(_amount > 0, ERROR_ZERO_AMOUNT);

        // move tokens to this contract
        ERC20 token = ERC20(_token);
        require(token.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        // get the Uniswap exchange for the external token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(_token);
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        require(token.safeApprove(address(uniswapExchange), _amount), ERROR_TOKEN_APPROVAL_FAILED);

        // swap tokens
        uint256 bondedTokenAmount = uniswapExchange.tokenToTokenSwapInput(_amount, _minTokens, _minEth, _deadline, address(bondedToken));

        // stake and activate in the registry
        _stakeAndActivate(_from, bondedTokenAmount, _activate);

        // refund leftovers if any
        _refund(token);
        _refund(bondedToken);
    }

    function _stakeAndActivate(address _from, uint256 _amount, bool _activate) internal {
        // activate in registry
        bondedToken.approve(address(registry), _amount);
        bytes memory data;
        if (_activate) {
            data = abi.encodePacked(ACTIVATE_DATA);
        }
        registry.stakeFor(_from, _amount, data);

        // refund leftovers if any
        _refund(bondedToken);
    }

    function _refund(ERC20 _token) internal {
        uint256 selfBalance = _token.balanceOf(address(this));
        if (selfBalance > 0) {
            require(_token.safeTransfer(msg.sender, selfBalance), ERROR_TOKEN_REFUND);
        }
    }
}
